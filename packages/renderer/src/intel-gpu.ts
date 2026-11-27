import {execFile} from 'node:child_process';
import {readdir, readFile} from 'node:fs/promises';
import path from 'node:path';
import type {LogLevel} from './log-level';
import {Log} from './logger';

// PCI device IDs of Intel GPUs older than Panther Lake, generated from the Linux
// kernel's include/drm/intel/pciids.h (MIT). IDs that are not listed here count
// as Panther Lake or newer, so future GPUs never trigger the warning.
const olderIntelGpuIds = new Set(
	`
0042 0046 0102 0106 010a 0112 0116 0122 0126 0152 0156 015a 0162 0166
016a 0402 0406 040a 040b 040e 0412 0416 041a 041b 041e 0422 0426 042a
042b 042e 0a02 0a06 0a0a 0a0b 0a0e 0a12 0a16 0a1a 0a1b 0a1e 0a22 0a26
0a2a 0a2b 0a2e 0a84 0b69 0b6e 0bd4 0bd5 0bd6 0bd7 0bd8 0bd9 0bda 0bdb
0be0 0be1 0be5 0c02 0c06 0c0a 0c0b 0c0e 0c12 0c16 0c1a 0c1b 0c1e 0c22
0c26 0c2a 0c2b 0c2e 0d02 0d06 0d0a 0d0b 0d0e 0d12 0d16 0d1a 0d1b 0d1e
0d22 0d26 0d2a 0d2b 0d2e 0f30 0f31 0f32 0f33 1132 1602 1606 160a 160b
160d 160e 1612 1616 161a 161b 161d 161e 1622 1626 162a 162b 162d 162e
1632 1636 163a 163b 163d 163e 1902 1906 190a 190b 190e 1912 1913 1915
1916 1917 191a 191b 191d 191e 1921 1923 1926 1927 192a 192b 192d 1932
193a 193b 193d 1a84 1a85 22b0 22b1 22b2 22b3 2562 2572 2582 258a 2592
2772 27a2 27ae 2972 2982 2992 29a2 29b2 29c2 29d2 2a02 2a12 2a42 2e02
2e12 2e22 2e32 2e42 2e92 3184 3185 3577 3582 358e 3e90 3e91 3e92 3e93
3e94 3e96 3e98 3e99 3e9a 3e9b 3e9c 3ea0 3ea1 3ea2 3ea3 3ea4 3ea5 3ea6
3ea7 3ea8 3ea9 4541 4551 4555 4557 4570 4571 4626 4628 462a 4680 4682
4688 468a 468b 4690 4692 4693 46a0 46a1 46a2 46a3 46a6 46a8 46aa 46b0
46b1 46b2 46b3 46c0 46c1 46c2 46c3 46d0 46d1 46d2 46d3 46d4 4905 4906
4907 4908 4909 4c80 4c8a 4c8b 4c8c 4c90 4c9a 4e51 4e55 4e57 4e61 4e71
5690 5691 5692 5693 5694 5695 5696 5697 56a0 56a1 56a2 56a3 56a4 56a5
56a6 56b0 56b1 56b2 56b3 56ba 56bb 56bc 56bd 56be 56bf 56c0 56c1 56c2
5902 5906 5908 590a 590b 590e 5912 5913 5915 5916 5917 591a 591b 591c
591d 591e 5921 5923 5926 5927 593b 5a40 5a41 5a42 5a44 5a49 5a4a 5a4c
5a50 5a51 5a52 5a54 5a59 5a5a 5a5c 5a84 5a85 6420 64a0 64b0 7121 7123
7125 7d40 7d41 7d45 7d51 7d55 7d60 7d67 7dd1 7dd5 87c0 87ca 8a50 8a51
8a52 8a53 8a54 8a56 8a57 8a58 8a59 8a5a 8a5b 8a5c 8a5d 8a70 8a71 9a40
9a49 9a59 9a60 9a68 9a70 9a78 9ac0 9ac9 9ad9 9af8 9b21 9b41 9ba2 9ba4
9ba5 9ba8 9baa 9bac 9bc2 9bc4 9bc5 9bc6 9bc8 9bca 9bcc 9be6 9bf6 a001
a011 a720 a721 a780 a781 a782 a783 a788 a789 a78a a78b a7a0 a7a1 a7a8
a7a9 a7aa a7ab a7ac a7ad b640 e202 e209 e20b e20c e20d e210 e211 e212
e216 e220 e221 e222 e223
`
		.trim()
		.split(/\s+/),
);

export const parseWindowsIntelGpuIds = (pnpDeviceIds: string) =>
	[...pnpDeviceIds.matchAll(/VEN_8086&DEV_([0-9A-F]{4})/gi)].map((match) =>
		match[1].toLowerCase(),
	);

export const readLinuxIntelGpuIds = async (drmDirectory: string) => {
	const renderNodes = (await readdir(drmDirectory)).filter((name) =>
		name.startsWith('renderD'),
	);
	const ids = await Promise.all(
		renderNodes.map(async (renderNode) => {
			const readId = async (file: 'vendor' | 'device') => {
				const content = await readFile(
					path.join(drmDirectory, renderNode, 'device', file),
					'utf8',
				);
				return content.trim().toLowerCase().replace(/^0x/, '');
			};

			return (await readId('vendor')) === '8086' ? readId('device') : null;
		}),
	);

	return ids.filter((id) => id !== null);
};

const readWindowsIntelGpuIds = () =>
	new Promise<string[]>((resolve, reject) => {
		execFile(
			'powershell.exe',
			[
				'-NoProfile',
				'-NonInteractive',
				'-Command',
				'(Get-CimInstance Win32_VideoController).PNPDeviceID',
			],
			{timeout: 10000, windowsHide: true},
			(err, stdout) => {
				if (err) {
					reject(err);
					return;
				}

				resolve(parseWindowsIntelGpuIds(stdout));
			},
		);
	});

export const readIntelGpuIds = () =>
	process.platform === 'win32'
		? readWindowsIntelGpuIds()
		: readLinuxIntelGpuIds('/sys/class/drm');

// Only warns: whether QSV runs is decided by the test encode. With several Intel
// GPUs it is unknown which one encodes, so every one of them has to be older.
export const warnIfIntelGpuIsOlderThanPantherLake = async ({
	indent,
	logLevel,
	readIds,
}: {
	indent: boolean;
	logLevel: LogLevel;
	readIds: () => Promise<string[]>;
}): Promise<boolean> => {
	try {
		const ids = await readIds();
		if (ids.length === 0 || !ids.every((id) => olderIntelGpuIds.has(id))) {
			return false;
		}

		Log.warn(
			{indent, logLevel},
			`Intel QSV is supported on Panther Lake GPUs and newer. The Intel GPU in this machine (device ID ${ids.join(', ')}) is older, so QSV is not supported on it. Remotion still uses QSV.`,
		);
		return true;
	} catch (err) {
		Log.verbose(
			{indent, logLevel},
			`Could not read the Intel GPU model: ${err}`,
		);
		return false;
	}
};

let intelGpuChecked = false;

// Does not delay the render: the GPU model is read in the background.
export const checkIntelGpuOnce = ({
	indent,
	logLevel,
}: {
	indent: boolean;
	logLevel: LogLevel;
}) => {
	if (intelGpuChecked) {
		return;
	}

	intelGpuChecked = true;
	warnIfIntelGpuIsOlderThanPantherLake({
		indent,
		logLevel,
		readIds: readIntelGpuIds,
	});
};
