import type {HardwareAccelerationOption} from './client';
import type {Codec} from './codec';
import {validateQualitySettings} from './crf';
import {getCodecName} from './get-codec-name';
import type {LogLevel} from './log-level';
import {Log} from './logger';
import {DEFAULT_COLOR_SPACE, type ColorSpace} from './options/color-space';
import {validateGopSize} from './options/gop-size';
import type {HardwareEncoder} from './options/hardware-encoder';
import {validateProResBitsPerMacroblock} from './options/prores-bits-per-macroblock';
import type {X264Preset} from './options/x264-preset';
import type {PixelFormat} from './pixel-format';
import {truthy} from './truthy';

// QSV ICQ quality (lower = better). Measured on one Intel Core Ultra system with
// h264_qsv/hevc_qsv, veryslow preset, lookahead on, VMAF scored at 1080p:
//   simple 4K motion-graphics ad: 22 -> VMAF 98.0, 28 -> 97.5, 34 -> 96.3 (H.264 and HEVC)
//   detailed 4K footage:          22 -> 98.2 (87 Mbps), 26 -> 96.8 (37 Mbps)    (H.264)
// 23 therefore targets a VMAF of roughly 97-98 (not compared against x264's CRF 18 default).
// On detailed footage it needs a high bitrate; raise the number to trade quality for size.
// Override with the REMOTION_QSV_QUALITY environment variable.
const DEFAULT_QSV_QUALITY = '23';

const firstEncodingStepOnly = ({
	hasPreencoded,
	proResProfileName,
	proResBitsPerMacroblock,
	pixelFormat,
	x264Preset,
	gopSize,
	codec,
	crf,
	videoBitrate,
	encodingMaxRate,
	encodingBufferSize,
	hardwareAcceleration,
	hardwareAccelerated,
	hardwareEncoder,
	cpuCount,
	lambdaMemoryInBytes,
}: {
	hasPreencoded: boolean;
	proResProfileName: string | null;
	proResBitsPerMacroblock: number | null;
	pixelFormat: PixelFormat;
	x264Preset: X264Preset | null;
	gopSize: number | null;
	crf: unknown;
	codec: Codec;
	videoBitrate: string | null;
	encodingMaxRate: string | null;
	encodingBufferSize: string | null;
	hardwareAcceleration: HardwareAccelerationOption;
	hardwareAccelerated: boolean;
	hardwareEncoder: HardwareEncoder | null;
	cpuCount: number;
	lambdaMemoryInBytes: number | null;
}): string[][] => {
	if (hasPreencoded || codec === 'gif') {
		return [];
	}

	validateGopSize(gopSize);

	return [
		proResProfileName ? ['-profile:v', proResProfileName] : null,
		proResBitsPerMacroblock === null
			? null
			: ['-bits_per_mb', String(proResBitsPerMacroblock)],
		['-pix_fmt', pixelFormat],

		// Without explicitly disabling auto-alt-ref,
		// transparent WebM generation doesn't work
		pixelFormat === 'yuva420p' ? ['-auto-alt-ref', '0'] : null,
		// Without row-based multithreading, libvpx only splits VP9 work by
		// tile columns (4 at 1080p), which leaves most cores idle. It is slower
		// with 2 CPUs outside Lambda. On Lambda, it is faster with the default
		// 2048 MB allocation even though only 2 CPUs are reported.
		codec === 'vp9' &&
		(cpuCount > 2 ||
			(lambdaMemoryInBytes !== null &&
				lambdaMemoryInBytes >= 2048 * 1024 * 1024))
			? ['-row-mt', '1']
			: null,
		x264Preset ? ['-preset', x264Preset] : null,
		// QSV has no default quality target (NVENC-like fixed low bitrate).
		// Use intelligent constant quality (ICQ) + lookahead, equivalent to CRF.
		hardwareAccelerated &&
		hardwareEncoder === 'qsv' &&
		(codec === 'h264' || codec === 'h265') &&
		!videoBitrate &&
		(crf === null || typeof crf === 'undefined')
			? [
					'-global_quality',
					process.env.REMOTION_QSV_QUALITY ?? DEFAULT_QSV_QUALITY,
					'-look_ahead',
					'1',
					// oneVPL target usage 1 (best quality): +~1 VMAF at equal size
					...(x264Preset ? [] : ['-preset', 'veryslow']),
				]
			: null,
		gopSize === null ? null : ['-g', String(gopSize)],
		// Apply a fixed a timescale across all environments:
		// https://discord.com/channels/809501355504959528/817306238811111454/1437471619089170613
		['-video_track_timescale', '90000'],
		validateQualitySettings({
			crf,
			videoBitrate,
			codec,
			encodingMaxRate,
			encodingBufferSize,
			hardwareAcceleration,
			hardwareAccelerated,
		}),
	].filter(truthy);
};

export const generateFfmpegArgs = ({
	hasPreencoded,
	proResProfileName,
	proResBitsPerMacroblock,
	pixelFormat,
	x264Preset,
	gopSize,
	codec,
	crf,
	videoBitrate,
	encodingMaxRate,
	encodingBufferSize,
	colorSpace,
	hardwareAcceleration,
	hardwareEncoder,
	indent,
	logLevel,
	cpuCount,
	lambdaMemoryInBytes,
}: {
	hasPreencoded: boolean;
	proResProfileName: string | null;
	proResBitsPerMacroblock: number | null;
	pixelFormat: PixelFormat;
	x264Preset: X264Preset | null;
	gopSize: number | null;
	crf: unknown;
	codec: Codec;
	videoBitrate: string | null;
	encodingMaxRate: string | null;
	encodingBufferSize: string | null;
	colorSpace: ColorSpace | null;
	hardwareAcceleration: HardwareAccelerationOption;
	hardwareEncoder: HardwareEncoder | null;
	indent: boolean;
	logLevel: LogLevel;
	cpuCount: number;
	lambdaMemoryInBytes: number | null;
}): string[][] => {
	validateProResBitsPerMacroblock(proResBitsPerMacroblock);
	if (proResBitsPerMacroblock !== null && codec !== 'prores') {
		throw new TypeError('proResBitsPerMacroblock requires the prores codec.');
	}

	const encoderSettings = getCodecName({
		codec,
		encodingMaxRate,
		encodingBufferSize,
		proResBitsPerMacroblock,
		crf,
		hardwareAcceleration,
		hardwareEncoder,
		indent,
		logLevel,
		onLog: null,
	});

	if (encoderSettings === null) {
		throw new TypeError(
			`encoderSettings is null: ${JSON.stringify(codec)} (hwaccel = ${hardwareAcceleration})`,
		);
	}

	const {encoderName, hardwareAccelerated} = encoderSettings;
	if (!hardwareAccelerated && hardwareAcceleration === 'required') {
		throw new Error(
			`Codec ${codec} does not support hardware acceleration on ${process.platform}, but "hardwareAcceleration" is set to "required"`,
		);
	}

	Log.verbose(
		{indent, logLevel, tag: 'stitchFramesToVideo()'},
		`Encoder: ${encoderName}, hardware accelerated: ${hardwareAccelerated}`,
	);

	const resolvedColorSpace: ColorSpace =
		codec === 'gif' ? 'bt601' : (colorSpace ?? DEFAULT_COLOR_SPACE);

	const colorSpaceOptions: string[][] =
		resolvedColorSpace === 'bt709'
			? [
					['-colorspace:v', 'bt709'],
					['-color_primaries:v', 'bt709'],
					['-color_trc:v', 'bt709'],
					['-color_range', 'tv'],
					hasPreencoded
						? []
						: // https://www.canva.dev/blog/engineering/a-journey-through-colour-space-with-ffmpeg/
							// "Color range" section
							[
								'-vf',
								'zscale=matrix=709:range=limited:primariesin=709:primaries=709:transferin=709:transfer=709',
							],
				]
			: resolvedColorSpace === 'bt2020-ncl'
				? [
						['-colorspace:v', 'bt2020nc'],
						['-color_primaries:v', 'bt2020'],
						['-color_trc:v', 'arib-std-b67'],
						['-color_range', 'tv'],
						hasPreencoded
							? []
							: [
									'-vf',
									// ChatGPT: Therefore, just like BT.709, BT.2020 also uses the limited range where the digital code value for black is at 16,16,16 and not 0,0,0 in an 8-bit video system.
									'zscale=matrix=2020_ncl:matrixin=2020_ncl:range=limited',
								],
					]
				: [];

	return [
		['-c:v', hasPreencoded ? 'copy' : encoderName],
		codec === 'h264-ts' ? ['-f', 'mpegts'] : null,
		// -c:v is the same as -vcodec as -codec:video
		// and specified the video codec.
		...colorSpaceOptions,
		...firstEncodingStepOnly({
			codec,
			crf,
			hasPreencoded,
			pixelFormat,
			proResProfileName,
			proResBitsPerMacroblock,
			videoBitrate,
			encodingMaxRate,
			encodingBufferSize,
			x264Preset,
			gopSize,
			hardwareAcceleration,
			hardwareAccelerated,
			hardwareEncoder,
			cpuCount,
			lambdaMemoryInBytes,
		}),
	].filter(truthy);
};
