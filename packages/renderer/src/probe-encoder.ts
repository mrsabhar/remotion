import {execFileSync} from 'node:child_process';
import path from 'path';
import type {OnLog} from './browser/BrowserPage';
import type {Codec} from './codec';
import {getExecutablePath} from './compositor/get-executable-path';
import {getExplicitEnv} from './compositor/get-explicit-env';
import {makeFileExecutableIfItIsNot} from './compositor/make-file-executable';
import {
	getCodecName,
	hasSpecifiedUnsupportedHardwareQualifySettings,
} from './get-codec-name';
import type {LogLevel} from './log-level';
import {Log} from './logger';
import type {HardwareAccelerationOption} from './options/hardware-acceleration';
import type {HardwareEncoder} from './options/hardware-encoder';
import {hardwareEncoders} from './options/hardware-encoder';

export type EncoderProbeResult = {
	available: boolean;
	reason: string | null;
};

// One probe per FFmpeg binary and encoder per process. A failed NVENC probe on an
// Intel-only PC would otherwise repeat at the start of every render.
const probeCache = new Map<string, EncoderProbeResult>();

const hardwareEncoderHint = (encoderName: string) => {
	if (encoderName.endsWith('_qsv')) {
		return " Remotion's bundled FFmpeg has no QSV. Use an FFmpeg build with QSV support (via `binariesDirectory` / `--binaries-directory`) and the Intel graphics driver.";
	}

	if (encoderName.endsWith('_nvenc')) {
		return ' NVENC needs an NVIDIA GPU and driver.';
	}

	return '';
};

/**
 * Probes FFmpeg to check if a specific encoder is available, and says why not if it is not.
 * Results are cached per FFmpeg binary and encoder.
 */
export const probeEncoder = ({
	encoderName,
	binariesDirectory,
	indent,
	logLevel,
}: {
	encoderName: string;
	binariesDirectory: string | null;
	indent: boolean;
	logLevel: LogLevel;
}): EncoderProbeResult => {
	try {
		const executablePath = getExecutablePath({
			type: 'ffmpeg',
			indent,
			logLevel,
			binariesDirectory,
		});
		const cacheKey = `${executablePath}|${encoderName}`;
		const cached = probeCache.get(cacheKey);
		if (cached) {
			return cached;
		}

		const finish = (probeResult: EncoderProbeResult) => {
			if (!probeResult.available) {
				Log.verbose(
					{indent, logLevel, tag: 'probeEncoder()'},
					probeResult.reason,
				);
			}

			probeCache.set(cacheKey, probeResult);
			return probeResult;
		};

		makeFileExecutableIfItIsNot(executablePath);

		const cwd = path.dirname(executablePath);
		const result = execFileSync(executablePath, ['-encoders'], {
			encoding: 'utf-8',
			env: getExplicitEnv(cwd),
			stdio: ['pipe', 'pipe', 'pipe'],
			timeout: 10000,
		});

		// FFmpeg -encoders output format: " V..... encoder_name"
		// Escape regex metacharacters and use word-boundary to avoid false positives
		const escaped = encoderName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		const encoderRegex = new RegExp(`\\b${escaped}\\b`);
		if (!encoderRegex.test(result)) {
			return finish({
				available: false,
				reason: `Encoder "${encoderName}" is not in this FFmpeg build.${hardwareEncoderHint(encoderName)}`,
			});
		}

		// `-encoders` lists every encoder compiled in, even NVENC on a machine
		// without an NVIDIA GPU. Encode a single frame to check that the encoder
		// can actually initialise on this hardware.
		// Remotion's bundled FFmpeg has no lavfi, so feed it a 1x1 PNG.
		try {
			execFileSync(
				executablePath,
				[
					'-hide_banner',
					'-loglevel',
					'error',
					'-f',
					'image2pipe',
					'-vcodec',
					'png',
					'-i',
					'-',
					'-vf',
					'scale=256:256,format=yuv420p',
					'-frames:v',
					'1',
					'-c:v',
					encoderName,
					'-f',
					'null',
					'-',
				],
				{
					env: getExplicitEnv(cwd),
					input: new Uint8Array(
						Buffer.from(
							'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
							'base64',
						),
					),
					stdio: ['pipe', 'pipe', 'pipe'],
					timeout: 10000,
				},
			);
		} catch (err) {
			const {stderr} = err as {stderr?: Buffer | string};
			const detail = (stderr ? String(stderr) : String(err))
				.trim()
				.split('\n')
				.slice(-2)
				.join(' ');
			return finish({
				available: false,
				reason: `Encoder "${encoderName}" is in the FFmpeg build but failed to initialise (${detail}).${hardwareEncoderHint(encoderName)}`,
			});
		}

		return finish({available: true, reason: null});
	} catch (err) {
		return {
			available: false,
			reason: `Failed to probe FFmpeg for encoder "${encoderName}": ${err}.`,
		};
	}
};

/**
 * Probes FFmpeg to check if a specific encoder is available.
 * Returns true if the encoder is supported, false otherwise.
 */
export const probeEncoderAvailability = (
	options: Parameters<typeof probeEncoder>[0],
): boolean => probeEncoder(options).available;

/**
 * Picks the hardware encoder when none was chosen explicitly:
 * NVENC first (the existing default), then QSV, using the cached probe.
 * An explicit `hardwareEncoder` is returned as-is.
 * Returns null if nothing is available (the caller then falls back to software,
 * or fails for `required`).
 */
export const resolveHardwareEncoder = ({
	codec,
	hardwareAcceleration,
	hardwareEncoder,
	binariesDirectory,
	indent,
	logLevel,
	crf,
	encodingMaxRate,
	encodingBufferSize,
	proResBitsPerMacroblock,
	probe,
}: {
	codec: Codec;
	hardwareAcceleration: HardwareAccelerationOption;
	hardwareEncoder: HardwareEncoder | null;
	binariesDirectory: string | null;
	indent: boolean;
	logLevel: LogLevel;
	crf: unknown;
	encodingMaxRate: string | null;
	encodingBufferSize: string | null;
	proResBitsPerMacroblock: number | null;
	// Replaces the FFmpeg probe, for tests
	probe: typeof probeEncoder | null;
}): HardwareEncoder | null => {
	if (hardwareEncoder !== null || hardwareAcceleration === 'disable') {
		return hardwareEncoder;
	}

	if (
		(codec !== 'h264' && codec !== 'h265') ||
		(process.platform !== 'win32' && process.platform !== 'linux') ||
		hasSpecifiedUnsupportedHardwareQualifySettings({
			crf,
			encodingMaxRate,
			encodingBufferSize,
			proResBitsPerMacroblock,
		})
	) {
		return null;
	}

	const reasons: string[] = [];
	for (const candidate of hardwareEncoders) {
		const encoderName = `${codec === 'h264' ? 'h264' : 'hevc'}_${candidate}`;
		const result = (probe ?? probeEncoder)({
			encoderName,
			binariesDirectory,
			indent,
			logLevel,
		});
		if (result.available) {
			Log.verbose(
				{indent, logLevel, tag: 'resolveHardwareEncoder()'},
				`Using hardware encoder "${encoderName}".`,
			);
			return candidate;
		}

		reasons.push(result.reason ?? encoderName);
	}

	if (hardwareAcceleration === 'required') {
		throw new Error(
			`Hardware acceleration is "required", but no hardware encoder is available. ${reasons.join(' ')}`,
		);
	}

	return null;
};

/**
 * Resolves the effective hardware acceleration setting by probing FFmpeg
 * for encoder availability. If the preferred hw encoder is not available:
 * - `if-possible` mode: falls back to software encoding
 * - `required` mode: throws a clear error
 */
export const resolveHardwareAcceleration = ({
	codec,
	hardwareAcceleration,
	hardwareEncoder,
	binariesDirectory,
	indent,
	logLevel,
	crf,
	encodingMaxRate,
	encodingBufferSize,
	proResBitsPerMacroblock,
	onLog,
}: {
	codec: Codec;
	hardwareAcceleration: HardwareAccelerationOption;
	hardwareEncoder: HardwareEncoder | null;
	binariesDirectory: string | null;
	indent: boolean;
	logLevel: LogLevel;
	crf: unknown;
	encodingMaxRate: string | null;
	encodingBufferSize: string | null;
	proResBitsPerMacroblock: number | null;
	onLog: OnLog | null;
}): HardwareAccelerationOption => {
	if (hardwareAcceleration === 'disable') {
		return 'disable';
	}

	const preferred = getCodecName({
		codec,
		hardwareAcceleration,
		hardwareEncoder,
		crf,
		encodingMaxRate,
		encodingBufferSize,
		proResBitsPerMacroblock,
		logLevel,
		indent,
		onLog,
	});

	// Audio codecs return null, no probing needed
	if (preferred === null) {
		return hardwareAcceleration;
	}

	// Only probe if getCodecName selected a hardware-accelerated encoder
	if (!preferred.hardwareAccelerated) {
		if (
			hardwareAcceleration === 'if-possible' &&
			hasSpecifiedUnsupportedHardwareQualifySettings({
				crf,
				encodingMaxRate,
				encodingBufferSize,
				proResBitsPerMacroblock,
			})
		) {
			return 'disable';
		}

		return hardwareAcceleration;
	}

	const probeResult = probeEncoder({
		encoderName: preferred.encoderName,
		binariesDirectory,
		indent,
		logLevel,
	});

	if (probeResult.available) {
		return hardwareAcceleration;
	}

	// Encoder not available in FFmpeg
	if (hardwareAcceleration === 'if-possible') {
		Log.verbose(
			{indent, logLevel, tag: 'resolveHardwareAcceleration()'},
			`Hardware encoder "${preferred.encoderName}" not available. Falling back to software encoding.`,
		);
		return 'disable';
	}

	// hardwareAcceleration === 'required'
	throw new Error(
		`Hardware encoder "${preferred.encoderName}" is not available. ${probeResult.reason ?? ''} ` +
			`Use "if-possible" mode instead of "required" to fall back to software encoding.`,
	);
};
