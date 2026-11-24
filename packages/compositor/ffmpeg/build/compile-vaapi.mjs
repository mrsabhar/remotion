import {execSync} from 'child_process';
import {existsSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {PREFIX} from './const.mjs';

const LIBDRM_TAG = 'libdrm-2.4.134';
const LIBVA_TAG = '2.24.1';
const DRIVER_DIR = '/usr/lib/x86_64-linux-gnu/dri';

const mergePrivateIntoPublic = (pcPath) => {
	let pc = readFileSync(pcPath, 'utf8');
	for (const key of ['Libs', 'Requires']) {
		const privateValue = pc
			.match(new RegExp(`^${key}\\.private:(.*)$`, 'm'))?.[1]
			?.trim();
		if (!privateValue) {
			continue;
		}

		pc = pc.match(new RegExp(`^${key}:`, 'm'))
			? pc.replace(
					new RegExp(`^${key}:(.*)$`, 'm'),
					(_, value) => `${key}:${value} ${privateValue}`,
				)
			: `${pc.trimEnd()}\n${key}: ${privateValue}\n`;
	}

	writeFileSync(pcPath, pc);
};

const buildWithMeson = ({dir, repo, tag, options, env}) => {
	if (!existsSync(dir)) {
		execSync(`git clone ${repo} ${dir}`, {stdio: 'inherit'});
	}

	execSync('git fetch --tags', {cwd: dir, stdio: 'inherit'});
	execSync(`git checkout ${tag}`, {cwd: dir, stdio: 'inherit'});

	rmSync(join(dir, 'build'), {force: true, recursive: true});
	const installPrefix = join(process.cwd(), PREFIX);
	execSync(
		[
			'meson setup build',
			`--prefix=${installPrefix}`,
			'--libdir=lib',
			'--buildtype=release',
			'--default-library=static',
			'-Db_staticpic=true',
			...options,
		].join(' '),
		{cwd: dir, stdio: 'inherit', env: {...process.env, ...env}},
	);
	execSync('ninja -C build install', {
		cwd: dir,
		stdio: 'inherit',
		env: {...process.env, ...env},
	});
};

export const enableVaapi = (shouldEnableQsv) => {
	if (!shouldEnableQsv) {
		return;
	}

	const pkgConfigPath = join(process.cwd(), PREFIX, 'lib', 'pkgconfig');

	buildWithMeson({
		dir: 'libdrm',
		repo: 'https://gitlab.freedesktop.org/mesa/drm.git',
		tag: LIBDRM_TAG,
		options: [
			'-Dintel=disabled',
			'-Dradeon=disabled',
			'-Damdgpu=disabled',
			'-Dnouveau=disabled',
			'-Dvmwgfx=disabled',
			'-Domap=disabled',
			'-Dexynos=disabled',
			'-Dfreedreno=disabled',
			'-Dtegra=disabled',
			'-Dvc4=disabled',
			'-Detnaviv=disabled',
			'-Dcairo-tests=disabled',
			'-Dvalgrind=disabled',
			'-Dman-pages=disabled',
			'-Dudev=false',
			'-Dtests=false',
		],
		env: {},
	});

	buildWithMeson({
		dir: 'libva',
		repo: 'https://github.com/intel/libva.git',
		tag: LIBVA_TAG,
		options: [
			`-Ddriverdir=${DRIVER_DIR}`,
			'-Dwith_x11=no',
			'-Dwith_glx=no',
			'-Dwith_wayland=no',
			'-Denable_docs=false',
		],
		env: {PKG_CONFIG_PATH: pkgConfigPath},
	});

	for (const pc of ['libdrm.pc', 'libva.pc', 'libva-drm.pc']) {
		mergePrivateIntoPublic(join(pkgConfigPath, pc));
	}
};
