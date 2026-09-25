#!/usr/bin/env node
/**
 * Starts the Firebase emulators for the local test build (`npm run emulators`).
 *
 * firebase-tools refuses Java older than 21, and the Java on PATH is often
 * older — while Android Studio quietly ships a Java 21 of its own. So this
 * looks for a Java that is new enough before giving up: JAVA_HOME, then PATH,
 * then the usual install places, and runs the emulators with it.
 *
 * The project is "demo-potok": a demo project id makes the emulators refuse
 * to touch any real Firebase service, so tests cannot reach production.
 *
 * With `--exec "<command>"` it starts Firestore alone, runs the command
 * against it and stops (the security rules tests, `npm run test:rules`).
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

const MIN_JAVA = 21;
const isWindows = process.platform === 'win32';
const javaExe = isWindows ? 'java.exe' : 'java';

const versionOf = (javaPath) => {
    const result = spawnSync(javaPath, ['-version'], { encoding: 'utf8' });
    const text = `${result.stderr || ''}${result.stdout || ''}`;
    const match = text.match(/version "(\d+)(?:\.(\d+))?/);
    if (!match) return 0;
    // Java 8 and older report themselves as 1.x.
    return match[1] === '1' ? Number(match[2]) : Number(match[1]);
};

const homesToTry = () => {
    const homes = [];
    if (process.env.JAVA_HOME) homes.push(process.env.JAVA_HOME);

    const roots = isWindows
        ? [
            'C:\\Program Files\\Android\\Android Studio\\jbr',
            path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Android Studio', 'jbr'),
            'C:\\Program Files\\Java',
            'C:\\Program Files\\Eclipse Adoptium',
            'C:\\Program Files\\Microsoft'
        ]
        : [
            '/Applications/Android Studio.app/Contents/jbr/Contents/Home',
            '/opt/android-studio/jbr',
            '/usr/lib/jvm',
            '/Library/Java/JavaVirtualMachines'
        ];

    for (const root of roots) {
        if (!root || !existsSync(root)) continue;
        homes.push(root);
        // Folders holding several JDKs side by side.
        try {
            for (const entry of readdirSync(root)) {
                homes.push(path.join(root, entry));
                homes.push(path.join(root, entry, 'Contents', 'Home'));
            }
        } catch { /* not a directory we can list */ }
    }

    return homes;
};

const findJavaHome = () => {
    if (versionOf(javaExe) >= MIN_JAVA) return null; // the one on PATH will do

    for (const home of homesToTry()) {
        const candidate = path.join(home, 'bin', javaExe);
        if (existsSync(candidate) && versionOf(candidate) >= MIN_JAVA) return home;
    }

    console.error(`Firebase emulators need Java ${MIN_JAVA}+, and none was found.`);
    console.error('Install a JDK 21 (e.g. Temurin) or point JAVA_HOME at one.');
    process.exit(1);
};

const javaHome = findJavaHome();
const env = { ...process.env };
if (javaHome) {
    env.JAVA_HOME = javaHome;
    env.PATH = `${path.join(javaHome, 'bin')}${path.delimiter}${process.env.PATH}`;
    console.log(`Using Java from ${javaHome}`);
}

const execIndex = process.argv.indexOf('--exec');
const execCommand = execIndex !== -1 ? process.argv[execIndex + 1] : null;

if (execIndex !== -1 && !execCommand) {
    console.error('Error: --exec requires a command.');
    process.exit(1);
}

const args = execCommand
    // Through cmd.exe on Windows the command has to be quoted to stay one argument.
    ? ['emulators:exec', '--only', 'firestore', '--project', 'demo-potok', isWindows ? JSON.stringify(execCommand) : execCommand]
    : ['emulators:start', '--only', 'auth,firestore', '--project', 'demo-potok'];

const child = spawn('firebase', args, { stdio: 'inherit', env, shell: isWindows });

child.on('exit', code => process.exit(code ?? 0));
