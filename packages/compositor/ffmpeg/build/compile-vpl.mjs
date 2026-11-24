import {execSync} from 'child_process';
import {existsSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {getCmakeCommand, getToolPath} from './compile-av1.mjs';
import {PREFIX} from './const.mjs';

// Intel oneVPL dispatcher (MIT). It is linked statically into libavcodec and
// loads the actual QSV runtime from the Intel graphics driver when an encoder
// is opened, so no extra DLL is shipped and machines without Intel graphics
// are unaffected. FFmpeg 7.1 needs libvpl >= 2.6.
const VPL_TAG = 'v2.15.0';
const VPL_BUILD_DIR = 'vpl-build';

export const enableVpl = (shouldEnableQsv) => {
	if (!shouldEnableQsv) {
		return;
	}

	const toolchain = {
		cc: getToolPath('x86_64-w64-mingw32-gcc'),
		cxx: getToolPath('x86_64-w64-mingw32-g++'),
		rc: getToolPath('x86_64-w64-mingw32-windres'),
		ar: getToolPath('x86_64-w64-mingw32-ar'),
		ranlib: getToolPath('x86_64-w64-mingw32-ranlib'),
	};

	if (!existsSync('vpl')) {
		execSync('git clone https://github.com/intel/libvpl.git vpl', {
			stdio: 'inherit',
		});
	}

	execSync('git fetch --tags', {cwd: 'vpl', stdio: 'inherit'});
	execSync(`git checkout ${VPL_TAG}`, {cwd: 'vpl', stdio: 'inherit'});

	rmSync(VPL_BUILD_DIR, {force: true, recursive: true});
	mkdirSync(VPL_BUILD_DIR, {recursive: true});

	const installPrefix = join(process.cwd(), 'vpl', PREFIX);
	execSync(
		[
			getCmakeCommand(),
			join(process.cwd(), 'vpl'),
			`-DCMAKE_INSTALL_PREFIX=${installPrefix}`,
			'-DCMAKE_INSTALL_LIBDIR=lib',
			'-DCMAKE_BUILD_TYPE=MinSizeRel',
			'-DBUILD_SHARED_LIBS=OFF',
			'-DBUILD_TESTS=OFF',
			'-DBUILD_EXAMPLES=OFF',
			'-DBUILD_TOOLS=OFF',
			'-DBUILD_PREVIEW=OFF',
			'-DBUILD_EXPERIMENTAL=OFF',
			'-DINSTALL_EXAMPLE_CODE=OFF',
			'-DCMAKE_POSITION_INDEPENDENT_CODE=ON',
			'-DCMAKE_SYSTEM_NAME=Windows',
			`-DCMAKE_C_COMPILER=${toolchain.cc}`,
			`-DCMAKE_CXX_COMPILER=${toolchain.cxx}`,
			`-DCMAKE_RC_COMPILER=${toolchain.rc}`,
			`-DCMAKE_AR=${toolchain.ar}`,
			`-DCMAKE_RANLIB=${toolchain.ranlib}`,
		].join(' '),
		{cwd: VPL_BUILD_DIR, stdio: 'inherit'},
	);

	execSync('make', {cwd: VPL_BUILD_DIR, stdio: 'inherit'});
	execSync('make install', {cwd: VPL_BUILD_DIR, stdio: 'inherit'});

	// FFmpeg is configured without `--pkg-config-flags=--static`, so move the
	// static link dependencies of the dispatcher from Libs.private to Libs.
	const pcPath = join(installPrefix, 'lib', 'pkgconfig', 'vpl.pc');
	const pc = readFileSync(pcPath, 'utf8');
	const privateLibs = pc.match(/^Libs\.private:(.*)$/m)?.[1]?.trim() ?? '';
	writeFileSync(
		pcPath,
		pc.replace(/^Libs:(.*)$/m, (_, libs) => `Libs:${libs} ${privateLibs}`),
	);

	execSync('cp -r ' + PREFIX + ' ../', {cwd: 'vpl', stdio: 'inherit'});
};
