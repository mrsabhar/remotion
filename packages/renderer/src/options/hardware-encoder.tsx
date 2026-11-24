import type {AnyRemotionOption} from './option';

export const hardwareEncoders = ['nvenc', 'qsv'] as const;

export type HardwareEncoder = (typeof hardwareEncoders)[number];

const cliFlag = 'hardware-encoder' as const;

let currentValue: HardwareEncoder | null = null;

export const validateHardwareEncoder = (
	value: unknown,
): HardwareEncoder | null => {
	if (value === null || value === undefined) {
		return null;
	}

	if (!hardwareEncoders.includes(value as HardwareEncoder)) {
		throw new TypeError(
			`${JSON.stringify(value)} is not a valid hardware encoder. Accepted values: ${hardwareEncoders
				.map((e) => JSON.stringify(e))
				.join(', ')}`,
		);
	}

	return value as HardwareEncoder;
};

export const hardwareEncoderOption = {
	name: 'Hardware encoder',
	addedIn: '4.0.547',
	cliFlag,
	description: () => (
		<>
			Which hardware encoder family to use on Windows and Linux when{' '}
			<a href="/docs/options/hardware-acceleration">hardware acceleration</a> is
			enabled. One of {'"nvenc"'} (NVIDIA) or {'"qsv"'} (Intel Quick Sync
			Video). Only applies to H.264 and H.265. On macOS, VideoToolbox is always
			used.
			<br />
			If not set, Remotion tries NVENC first, then QSV, and uses the first one
			that can encode a test frame on this machine. If none works,{' '}
			{'"if-possible"'} falls back to software encoding and {'"required"'}{' '}
			throws an error that says why each encoder failed.
			<br />
			With {'"qsv"'} and no <code>crf</code> or <code>videoBitrate</code> set,
			Remotion uses intelligent constant quality (ICQ) with look-ahead, because
			QSV has no usable default quality target. The default ICQ value is 23; set
			the <code>REMOTION_QSV_QUALITY</code> environment variable to change it
			(higher is smaller and lower quality).
			<br />
			Your FFmpeg build must include the QSV encoders (Remotion&apos;s bundled
			FFmpeg does not) and the audio encoder Remotion uses (
			<code>libfdk_aac</code>), and you pass it with{' '}
			<code>binariesDirectory</code>. The <code>REMOTION_HW_ENCODER</code>{' '}
			environment variable is also read when neither the CLI flag nor the config
			option is set.
		</>
	),
	ssrName: 'hardwareEncoder',
	docLink: 'https://www.remotion.dev/docs/options/hardware-encoder',
	type: 'nvenc' as HardwareEncoder | null,
	getValue: ({commandLine}) => {
		if (commandLine[cliFlag] !== undefined) {
			return {
				source: 'cli',
				value: validateHardwareEncoder(commandLine[cliFlag]),
			};
		}

		if (currentValue !== null) {
			return {
				source: 'config',
				value: currentValue,
			};
		}

		const fromEnv = process.env.REMOTION_HW_ENCODER;
		if (fromEnv) {
			return {
				source: 'env',
				value: validateHardwareEncoder(fromEnv),
			};
		}

		return {
			source: 'default',
			value: null,
		};
	},
	setConfig: (value: HardwareEncoder | null) => {
		currentValue = validateHardwareEncoder(value);
	},
	id: cliFlag,
} satisfies AnyRemotionOption<HardwareEncoder | null>;
