import {afterEach, describe, expect, mock, test} from 'bun:test';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';

mock.module('remotion/version', () => ({
	VERSION: '4.0.0-test',
}));

const {
	parseWindowsIntelGpuIds,
	readLinuxIntelGpuIds,
	warnIfIntelGpuIsOlderThanPantherLake,
} = require('../intel-gpu');

describe('reading Intel GPU IDs', () => {
	test('Windows: takes Intel adapters only', () => {
		expect(
			parseWindowsIntelGpuIds(
				[
					'PCI\\VEN_8086&DEV_B080&SUBSYS_00000000&REV_04\\3&0&0&10',
					'PCI\\VEN_10DE&DEV_2684&SUBSYS_00000000&REV_A1\\4&0&0&08',
					'ROOT\\DISPLAY\\0000',
					'PCI\\VEN_8086&DEV_56A0&SUBSYS_00000000&REV_08\\6&0&0&08',
				].join('\r\n'),
			),
		).toEqual(['b080', '56a0']);
	});

	const directories: string[] = [];
	afterEach(() => {
		for (const directory of directories.splice(0)) {
			rmSync(directory, {recursive: true, force: true});
		}
	});

	test('Linux: reads render nodes and takes Intel adapters only', async () => {
		const drm = mkdtempSync(path.join(tmpdir(), 'remotion-drm-'));
		directories.push(drm);
		const addNode = (name: string, vendor: string, device: string) => {
			const directory = path.join(drm, name, 'device');
			mkdirSync(directory, {recursive: true});
			writeFileSync(path.join(directory, 'vendor'), `${vendor}\n`);
			writeFileSync(path.join(directory, 'device'), `${device}\n`);
		};

		addNode('renderD128', '0x8086', '0xb080');
		addNode('renderD129', '0x10de', '0x2684');
		// Not a render node
		mkdirSync(path.join(drm, 'card0'));

		expect(await readLinuxIntelGpuIds(drm)).toEqual(['b080']);
	});
});

describe('Panther Lake warning', () => {
	const warns = (ids: string[]) =>
		warnIfIntelGpuIsOlderThanPantherLake({
			indent: false,
			logLevel: 'error',
			readIds: () => Promise.resolve(ids),
		});

	test.each([
		['Tiger Lake', '9a49'],
		['Meteor Lake', '7d55'],
		['Lunar Lake', '64a0'],
		['Arc A-series', '56a0'],
		['Arc B-series', 'e20b'],
	])('warns for %s', async (_, id) => {
		expect(await warns([id])).toBe(true);
	});

	test.each([
		['Panther Lake', 'b080'],
		['Wildcat Lake', 'fd80'],
		['Nova Lake', 'd750'],
		['a GPU newer than the list', 'ffff'],
	])('stays silent for %s', async (_, id) => {
		expect(await warns([id])).toBe(false);
	});

	test('stays silent if one of several Intel GPUs is supported', async () => {
		expect(await warns(['b080', 'e20b'])).toBe(false);
	});

	test('stays silent if no Intel GPU is found', async () => {
		expect(await warns([])).toBe(false);
	});

	test('never fails the render if the GPU cannot be read', async () => {
		expect(
			await warnIfIntelGpuIsOlderThanPantherLake({
				indent: false,
				logLevel: 'error',
				readIds: () => Promise.reject(new Error('no access')),
			}),
		).toBe(false);
	});
});

describe('when the GPU is checked', () => {
	const {resolveHardwareEncoder} = require('../probe-encoder');
	const originalPlatform = process.platform;
	afterEach(() => {
		Object.defineProperty(process, 'platform', {value: originalPlatform});
	});

	const checks = (extra: object, works: string[] = ['qsv']) => {
		Object.defineProperty(process, 'platform', {value: 'linux'});
		let count = 0;
		resolveHardwareEncoder({
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
			probe: ({encoderName}: {encoderName: string}) => ({
				available: works.some((w) => encoderName.endsWith(`_${w}`)),
				reason: null,
			}),
			checkIntelGpu: () => {
				count++;
			},
			...extra,
		});
		return count;
	};

	test('when QSV is auto-selected', () => {
		expect(checks({})).toBe(1);
	});

	test('when QSV is chosen explicitly', () => {
		expect(checks({hardwareEncoder: 'qsv'})).toBe(1);
	});

	test('not when NVENC is used', () => {
		expect(checks({}, ['nvenc', 'qsv'])).toBe(0);
		expect(checks({hardwareEncoder: 'nvenc'})).toBe(0);
	});

	test('not when QSV is not used', () => {
		expect(checks({}, [])).toBe(0);
		expect(
			checks({hardwareEncoder: 'qsv', hardwareAcceleration: 'disable'}),
		).toBe(0);
		expect(checks({hardwareEncoder: 'qsv', codec: 'vp9'})).toBe(0);
		expect(checks({hardwareEncoder: 'qsv', crf: 18})).toBe(0);
	});
});
