import {afterEach, describe, expect, mock, test} from 'bun:test';

// Mock remotion/version before importing
mock.module('remotion/version', () => ({
	VERSION: '4.0.0-test',
}));

const {resolveHardwareAcceleration} = require('../probe-encoder');

/**
 * Tests for resolveHardwareAcceleration that DO NOT trigger actual FFmpeg probing.
 * These test the logic branches that short-circuit before any execFileSync call:
 * - "disable" passthrough
 * - Audio codec passthrough (getCodecName returns null)
 * - Software encoder passthrough (getCodecName returns non-hw-accelerated)
 *
 * Probing-dependent paths (if-possible/required with hardware encoders) are
 * exercised by integration tests that run with the real FFmpeg binary.
 */
describe('resolveHardwareAcceleration', () => {
	const originalPlatform = process.platform;
	const setPlatform = (platform: string) => {
		Object.defineProperty(process, 'platform', {value: platform});
	};

	const restorePlatform = () => {
		Object.defineProperty(process, 'platform', {value: originalPlatform});
	};

	test('returns "disable" when hardwareAcceleration is "disable"', () => {
		expect(
			resolveHardwareAcceleration({
				codec: 'h264',
				hardwareAcceleration: 'disable',
				hardwareEncoder: null,
				binariesDirectory: null,
				indent: false,
				logLevel: 'warn',
				crf: null,
				encodingMaxRate: null,
				encodingBufferSize: null,
				proResBitsPerMacroblock: null,
				onLog: null,
			}),
		).toBe('disable');
	});

	test('returns original value for audio codecs (null from getCodecName)', () => {
		expect(
			resolveHardwareAcceleration({
				codec: 'mp3',
				hardwareAcceleration: 'if-possible',
				hardwareEncoder: null,
				binariesDirectory: null,
				indent: false,
				logLevel: 'warn',
				crf: null,
				encodingMaxRate: null,
				encodingBufferSize: null,
				proResBitsPerMacroblock: null,
				onLog: null,
			}),
		).toBe('if-possible');
	});

	test('returns original value for aac codec', () => {
		expect(
			resolveHardwareAcceleration({
				codec: 'aac',
				hardwareAcceleration: 'required',
				hardwareEncoder: null,
				binariesDirectory: null,
				indent: false,
				logLevel: 'warn',
				crf: null,
				encodingMaxRate: null,
				encodingBufferSize: null,
				proResBitsPerMacroblock: null,
				onLog: null,
			}),
		).toBe('required');
	});

	test('returns original value for wav codec', () => {
		expect(
			resolveHardwareAcceleration({
				codec: 'wav',
				hardwareAcceleration: 'if-possible',
				hardwareEncoder: null,
				binariesDirectory: null,
				indent: false,
				logLevel: 'warn',
				crf: null,
				encodingMaxRate: null,
				encodingBufferSize: null,
				proResBitsPerMacroblock: null,
				onLog: null,
			}),
		).toBe('if-possible');
	});

	describe('software encoder passthrough', () => {
		afterEach(restorePlatform);

		test('reports why CRF disables hardware acceleration on Windows', () => {
			setPlatform('win32');
			const onLog = mock(() => undefined);
			expect(
				resolveHardwareAcceleration({
					codec: 'h264',
					hardwareAcceleration: 'if-possible',
					hardwareEncoder: null,
					binariesDirectory: null,
					indent: false,
					logLevel: 'warn',
					crf: 20,
					encodingMaxRate: null,
					encodingBufferSize: null,
					proResBitsPerMacroblock: null,
					onLog,
				}),
			).toBe('disable');
			expect(onLog).toHaveBeenCalledTimes(1);
			expect(onLog).toHaveBeenCalledWith({
				logLevel: 'warn',
				previewString:
					'Hardware accelerated encoding disabled - "crf" option is not supported with hardware acceleration',
				tag: '',
			});
		});

		test('returns original value when codec has no hw encoder (vp8)', () => {
			setPlatform('linux');
			expect(
				resolveHardwareAcceleration({
					codec: 'vp8',
					hardwareAcceleration: 'if-possible',
					hardwareEncoder: null,
					binariesDirectory: null,
					indent: false,
					logLevel: 'warn',
					crf: null,
					encodingMaxRate: null,
					encodingBufferSize: null,
					proResBitsPerMacroblock: null,
					onLog: null,
				}),
			).toBe('if-possible');
		});

		test('returns original value when codec has no hw encoder (av1)', () => {
			setPlatform('linux');
			expect(
				resolveHardwareAcceleration({
					codec: 'av1',
					hardwareAcceleration: 'if-possible',
					hardwareEncoder: null,
					binariesDirectory: null,
					indent: false,
					logLevel: 'warn',
					crf: null,
					encodingMaxRate: null,
					encodingBufferSize: null,
					proResBitsPerMacroblock: null,
					onLog: null,
				}),
			).toBe('if-possible');
		});

		test('returns "disable" when hardwareAcceleration is "disable" even with NVENC-capable codec', () => {
			setPlatform('linux');
			expect(
				resolveHardwareAcceleration({
					codec: 'h264',
					hardwareAcceleration: 'disable',
					hardwareEncoder: null,
					binariesDirectory: null,
					indent: false,
					logLevel: 'warn',
					crf: null,
					encodingMaxRate: null,
					encodingBufferSize: null,
					proResBitsPerMacroblock: null,
					onLog: null,
				}),
			).toBe('disable');
		});
	});
});

describe('probeEncoderAvailability (real FFmpeg)', () => {
	const {probeEncoderAvailability} = require('../probe-encoder');
	const probe = (encoderName: string) =>
		probeEncoderAvailability({
			encoderName,
			binariesDirectory: null,
			indent: false,
			logLevel: 'error',
		});

	test('software encoder initialises', () => {
		expect(probe('libx264')).toBe(true);
	});

	test('unknown encoder is rejected', () => {
		expect(probe('definitely_not_an_encoder')).toBe(false);
	});

	// Listed in Remotion's bundled FFmpeg, but cannot start without an NVIDIA GPU.
	// Skipped on machines that do have one.
	const hasNvidia =
		require('node:child_process').spawnSync('nvidia-smi').status === 0;
	test.skipIf(hasNvidia)(
		'NVENC is rejected when no NVIDIA GPU is present',
		() => {
			expect(probe('h264_nvenc')).toBe(false);
		},
	);
});

describe('resolveHardwareEncoder', () => {
	const {resolveHardwareEncoder} = require('../probe-encoder');
	const base = {
		codec: 'h264',
		hardwareAcceleration: 'if-possible',
		hardwareEncoder: null,
		binariesDirectory: null,
		indent: false,
		logLevel: 'error',
		crf: null,
		encodingMaxRate: null,
		encodingBufferSize: null,
		proResBitsPerMacroblock: null,
		probe: null,
		checkIntelGpu: () => undefined,
	};
	const originalPlatform = process.platform;
	afterEach(() => {
		Object.defineProperty(process, 'platform', {value: originalPlatform});
	});

	test('keeps an explicit choice without probing', () => {
		expect(resolveHardwareEncoder({...base, hardwareEncoder: 'qsv'})).toBe(
			'qsv',
		);
	});

	test('does nothing when hardware acceleration is disabled', () => {
		expect(
			resolveHardwareEncoder({...base, hardwareAcceleration: 'disable'}),
		).toBe(null);
	});

	test('does nothing for codecs without a hardware encoder', () => {
		expect(resolveHardwareEncoder({...base, codec: 'vp9'})).toBe(null);
	});

	test('does nothing when crf rules out hardware encoding', () => {
		expect(resolveHardwareEncoder({...base, crf: 18})).toBe(null);
	});

	test('does nothing on macOS', () => {
		Object.defineProperty(process, 'platform', {value: 'darwin'});
		expect(resolveHardwareEncoder(base)).toBe(null);
	});
});

// Which encoders initialise depends on the GPU, not on the CPU vendor.
// Simulated machines; each lists the encoders whose test encode succeeds.
describe('resolveHardwareEncoder across machines', () => {
	const {resolveHardwareEncoder} = require('../probe-encoder');
	const originalPlatform = process.platform;
	afterEach(() => {
		Object.defineProperty(process, 'platform', {value: originalPlatform});
	});

	const machines: {
		name: string;
		works: string[];
		platform: string;
		expected: 'nvenc' | 'qsv' | null;
	}[] = [
		{
			name: 'Intel iGPU (Core Ultra)',
			works: ['qsv'],
			platform: 'win32',
			expected: 'qsv',
		},
		{
			name: 'Intel dGPU (Arc) with AMD CPU',
			works: ['qsv'],
			platform: 'win32',
			expected: 'qsv',
		},
		{
			name: 'NVIDIA dGPU with AMD CPU',
			works: ['nvenc'],
			platform: 'win32',
			expected: 'nvenc',
		},
		{
			name: 'NVIDIA dGPU with Intel CPU, iGPU also present',
			works: ['nvenc', 'qsv'],
			platform: 'win32',
			expected: 'nvenc',
		},
		{
			name: 'AMD GPU, no NVIDIA or Intel GPU',
			works: [],
			platform: 'win32',
			expected: null,
		},
		{
			name: 'Intel on Linux (QSV runtime installed)',
			works: ['qsv'],
			platform: 'linux',
			expected: 'qsv',
		},
		{
			name: 'Intel on Linux without QSV runtime',
			works: [],
			platform: 'linux',
			expected: null,
		},
	];

	const fakeProbe =
		(works: string[]) =>
		({encoderName}: {encoderName: string}) => {
			const ok = works.some((w) => encoderName.endsWith(`_${w}`));
			return {available: ok, reason: ok ? null : `${encoderName} failed`};
		};

	const args = (probe: unknown, extra: object) => ({
		codec: 'h264',
		hardwareAcceleration: 'if-possible',
		hardwareEncoder: null,
		binariesDirectory: null,
		indent: false,
		logLevel: 'error',
		crf: null,
		encodingMaxRate: null,
		encodingBufferSize: null,
		proResBitsPerMacroblock: null,
		probe,
		checkIntelGpu: () => undefined,
		...extra,
	});

	for (const m of machines) {
		test(`${m.name}: if-possible picks ${m.expected ?? 'software'}`, () => {
			Object.defineProperty(process, 'platform', {value: m.platform});
			expect(resolveHardwareEncoder(args(fakeProbe(m.works), {}))).toBe(
				m.expected,
			);
		});

		test(`${m.name}: required ${m.expected ? 'picks ' + m.expected : 'throws and says why'}`, () => {
			Object.defineProperty(process, 'platform', {value: m.platform});
			const run = () =>
				resolveHardwareEncoder(
					args(fakeProbe(m.works), {hardwareAcceleration: 'required'}),
				);
			if (m.expected) {
				expect(run()).toBe(m.expected);
			} else {
				expect(run).toThrow(/h264_nvenc failed.*h264_qsv failed/);
			}
		});
	}

	test('H.265 asks for the hevc encoders', () => {
		const seen: string[] = [];
		resolveHardwareEncoder(
			args(
				({encoderName}: {encoderName: string}) => {
					seen.push(encoderName);
					return {available: false, reason: ''};
				},
				{codec: 'h265'},
			),
		);
		expect(seen).toEqual(['hevc_nvenc', 'hevc_qsv']);
	});

	test('an explicit hardwareEncoder is never probed', () => {
		const probe = mock(() => ({available: false, reason: ''}));
		expect(resolveHardwareEncoder(args(probe, {hardwareEncoder: 'qsv'}))).toBe(
			'qsv',
		);
		expect(probe).not.toHaveBeenCalled();
	});
});
