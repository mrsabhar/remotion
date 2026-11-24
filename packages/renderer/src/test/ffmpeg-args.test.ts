import {afterEach, expect, test} from 'bun:test';
import type {Codec} from '../codec';
import {generateFfmpegArgs} from '../ffmpeg-args';
import type {HardwareAccelerationOption} from '../options/hardware-acceleration';
import type {HardwareEncoder} from '../options/hardware-encoder';

const originalPlatform = process.platform;

const setPlatform = (platform: string) => {
	Object.defineProperty(process, 'platform', {value: platform});
};

const restorePlatform = () => {
	Object.defineProperty(process, 'platform', {value: originalPlatform});
};

afterEach(restorePlatform);

const makeArgs = ({
	codec,
	crf = null,
	hardwareAcceleration,
	hardwareEncoder = null,
}: {
	codec: Codec;
	crf?: number | null;
	hardwareAcceleration: HardwareAccelerationOption;
	hardwareEncoder?: HardwareEncoder | null;
}) =>
	generateFfmpegArgs({
		hasPreencoded: false,
		proResProfileName: null,
		pixelFormat: 'yuv420p',
		x264Preset: null,
		gopSize: null,
		proResBitsPerMacroblock: null,
		codec,
		crf,
		videoBitrate: null,
		encodingMaxRate: null,
		encodingBufferSize: null,
		colorSpace: 'default',
		hardwareAcceleration,
		hardwareEncoder,
		indent: false,
		logLevel: 'info',
		cpuCount: 4,
		lambdaMemoryInBytes: null,
	}).flat();

test('does not pass the default CRF option to hardware encoders', () => {
	setPlatform('linux');

	const args = makeArgs({
		codec: 'h264',
		hardwareAcceleration: 'if-possible',
	});

	expect(args).toContain('h264_nvenc');
	expect(args).not.toContain('-crf');
});

test('keeps default CRF for software encoders when hardware acceleration is not used', () => {
	setPlatform('linux');

	const args = makeArgs({
		codec: 'vp8',
		hardwareAcceleration: 'if-possible',
	});

	expect(args).toContain('libvpx');
	expect(args).toContain('-crf');
	expect(args).toContain('9');
});

test('keeps explicit CRF when if-possible falls back to software', () => {
	setPlatform('linux');

	const args = makeArgs({
		codec: 'h264',
		crf: 20,
		hardwareAcceleration: 'if-possible',
	});

	expect(args).toContain('libx264');
	expect(args).toContain('-crf');
	expect(args).toContain('20');
});

test('QSV: uses ICQ quality with look-ahead when no crf or bitrate is set', () => {
	setPlatform('win32');

	const args = makeArgs({
		codec: 'h264',
		hardwareAcceleration: 'required',
		hardwareEncoder: 'qsv',
	});

	expect(args).toEqual(
		expect.arrayContaining([
			'h264_qsv',
			'-global_quality',
			'23',
			'-look_ahead',
		]),
	);
	expect(args).toContain('veryslow');
});

test('NVENC stays the default and gets no QSV arguments', () => {
	setPlatform('win32');

	const args = makeArgs({codec: 'h264', hardwareAcceleration: 'required'});

	expect(args).toContain('h264_nvenc');
	expect(args).not.toContain('-global_quality');
});
