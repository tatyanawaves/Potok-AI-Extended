/**
 * Google Cloud Run deployments for bots, on each user's own Google Cloud
 * project: the user saves a service-account key (JSON) once, the worker keeps
 * it sealed per account, and bots deploy through these MCP tools.
 *
 *   POST /tools/cloudrun   MCP
 *
 * Three ways in, all ending as a Cloud Run service with a public URL:
 *   - a ready container image;
 *   - files a bot wrote (uploaded to Cloud Storage, built by Cloud Build —
 *     with the Dockerfile if there is one, buildpacks otherwise);
 *   - a public GitHub repository.
 *
 * Builds take minutes; the deploy tools return a build id at once, and the bot
 * checks it with cloudrun_build_status — inside a task, after wait_and_resume.
 *
 * The service account needs: Cloud Run Admin, Cloud Build Editor, Storage
 * Admin, Artifact Registry Administrator, Service Account User (on the
 * default compute account). The APIs run, cloudbuild, artifactregistry and
 * storage must be enabled in the project.
 */

import type { ServerTool } from './mcpServer';

export interface ServiceAccount {
    project_id: string;
    client_email: string;
    private_key: string;
}

export interface GcpConfig {
    account: ServiceAccount;
    region: string;
}

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REPOSITORY = 'potok';

// --- Auth ---------------------------------------------------------------------------------

const b64url = (data: Uint8Array | string) => {
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    let binary = '';
    bytes.forEach(b => { binary += String.fromCharCode(b); });
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const pemToDer = (pem: string): ArrayBuffer => {
    const body = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
    return Uint8Array.from(atob(body), c => c.charCodeAt(0)).buffer;
};

/** A signed JWT assertion for the OAuth token endpoint (RFC 7523), made with Web Crypto. */
export const signAssertion = async (account: ServiceAccount, now = Math.floor(Date.now() / 1000)): Promise<string> => {
    const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claims = b64url(JSON.stringify({
        iss: account.client_email,
        scope: 'https://www.googleapis.com/auth/cloud-platform',
        aud: TOKEN_URL,
        iat: now,
        exp: now + 3600
    }));
    const key = await crypto.subtle.importKey(
        'pkcs8', pemToDer(account.private_key), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']
    );
    const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${header}.${claims}`));
    return `${header}.${claims}.${b64url(new Uint8Array(signature))}`;
};

export const parseServiceAccount = (raw: string): ServiceAccount => {
    let data: any;
    try { data = JSON.parse(raw); } catch { throw new Error('Это не JSON ключа сервисного аккаунта'); }
    if (data.type !== 'service_account' || !data.project_id || !data.client_email || !data.private_key) {
        throw new Error('Нужен JSON-ключ сервисного аккаунта (type: service_account)');
    }
    return { project_id: data.project_id, client_email: data.client_email, private_key: data.private_key };
};

const tokenCache = new Map<string, { token: string, expiresAt: number }>();

export const accessToken = async (account: ServiceAccount): Promise<string> => {
    const cached = tokenCache.get(account.client_email);
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

    const r = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
            assertion: await signAssertion(account)
        }).toString()
    });
    const data: any = await r.json().catch(() => ({}));
    if (!r.ok || !data.access_token) throw new Error(`Google не выдал токен: ${data.error_description || data.error || r.status}`);
    tokenCache.set(account.client_email, { token: data.access_token, expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000 });
    return data.access_token;
};

const gfetch = async (config: GcpConfig, url: string, init: RequestInit = {}, okStatuses: number[] = []): Promise<any> => {
    const r = await fetch(url, {
        ...init,
        headers: { Authorization: `Bearer ${await accessToken(config.account)}`, 'Content-Type': 'application/json', ...(init.headers || {}) }
    });
    if (!r.ok && !okStatuses.includes(r.status)) {
        const body: any = await r.json().catch(() => ({}));
        throw new Error(`${body?.error?.message || r.status} (${new URL(url).host})`);
    }
    return r.status === 204 ? {} : r.json().catch(() => ({}));
};

/** Checks a saved key really works: a token, and read access to Cloud Run in the project. */
export const validateGcp = async (config: GcpConfig): Promise<void> => {
    await gfetch(config, `https://run.googleapis.com/v2/projects/${config.account.project_id}/locations/${config.region}/services?pageSize=1`);
};

// --- Source packaging ------------------------------------------------------------------------

/** A ustar archive of text files — what Cloud Build takes as source. */
export const tarFiles = (files: Array<{ path: string, content: string }>): Uint8Array => {
    const enc = new TextEncoder();
    const blocks: Uint8Array[] = [];
    const field = (buf: Uint8Array, offset: number, length: number, value: string) =>
        buf.set(enc.encode(value).slice(0, length), offset);

    for (const file of files) {
        const path = file.path.replace(/^\/+/, '').replace(/\.\.\//g, '');
        const data = enc.encode(file.content);
        const header = new Uint8Array(512);
        field(header, 0, 100, path);
        field(header, 100, 8, '0000644\0');
        field(header, 108, 8, '0000000\0');
        field(header, 116, 8, '0000000\0');
        field(header, 124, 12, `${data.length.toString(8).padStart(11, '0')}\0`);
        field(header, 136, 12, `${Math.floor(Date.now() / 1000).toString(8).padStart(11, '0')}\0`);
        header.fill(32, 148, 156);          // checksum counted as spaces
        header[156] = 48;                   // '0': regular file
        field(header, 257, 6, 'ustar\0');
        field(header, 263, 2, '00');
        const sum = header.reduce((a, b) => a + b, 0);
        field(header, 148, 8, `${sum.toString(8).padStart(6, '0')}\0 `);
        blocks.push(header, data, new Uint8Array((512 - (data.length % 512)) % 512));
    }
    blocks.push(new Uint8Array(1024));

    const out = new Uint8Array(blocks.reduce((n, b) => n + b.length, 0));
    let offset = 0;
    for (const b of blocks) { out.set(b, offset); offset += b.length; }
    return out;
};

const gzip = async (data: Uint8Array): Promise<Uint8Array> =>
    new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());

// --- Cloud Run ---------------------------------------------------------------------------------

const serviceName = (raw: unknown): string => {
    const name = String(raw || '').toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '').slice(0, 49);
    if (!/^[a-z]/.test(name)) throw new Error('Имя сервиса: латиница, цифры и дефисы, начиная с буквы');
    return name;
};

const imageFor = (config: GcpConfig, service: string) =>
    `${config.region}-docker.pkg.dev/${config.account.project_id}/${REPOSITORY}/${service}:${Date.now()}`;

const runBase = (config: GcpConfig) =>
    `https://run.googleapis.com/v2/projects/${config.account.project_id}/locations/${config.region}/services`;

/** Creates the service, or replaces its container if it exists; optionally public. */
const deployImage = async (
    config: GcpConfig, service: string, image: string, port: number, env: Record<string, string>, isPublic: boolean
): Promise<string> => {
    const template = {
        containers: [{
            image,
            ports: [{ containerPort: port }],
            env: Object.entries(env).map(([name, value]) => ({ name, value: String(value) }))
        }]
    };
    const existing = await gfetch(config, `${runBase(config)}/${service}`, {}, [404]);
    if (existing?.name) {
        await gfetch(config, `${runBase(config)}/${service}`, { method: 'PATCH', body: JSON.stringify({ template }) });
    } else {
        await gfetch(config, `${runBase(config)}?serviceId=${service}`, { method: 'POST', body: JSON.stringify({ template }) });
    }
    if (isPublic) {
        // Retried briefly: a service still being created can refuse the policy.
        for (let i = 0; i < 6; i++) {
            try {
                await gfetch(config, `${runBase(config)}/${service}:setIamPolicy`, {
                    method: 'POST',
                    body: JSON.stringify({ policy: { bindings: [{ role: 'roles/run.invoker', members: ['allUsers'] }] } })
                });
                break;
            } catch (error) {
                if (i === 5) throw error;
                await new Promise(r => setTimeout(r, 3000));
            }
        }
    }
    return `Развёртывание «${service}» запущено (${image}). Проверьте cloudrun_service_status через минуту — там будет адрес.`;
};

const ensureRepository = async (config: GcpConfig) => {
    await gfetch(config,
        `https://artifactregistry.googleapis.com/v1/projects/${config.account.project_id}/locations/${config.region}/repositories?repositoryId=${REPOSITORY}`,
        { method: 'POST', body: JSON.stringify({ format: 'DOCKER', description: 'Images built by Potok bots' }) },
        [409]);
};

/** Starts a Cloud Build that builds the source and deploys the result; returns the build id. */
const buildAndDeploy = async (
    config: GcpConfig, service: string, source: Record<string, unknown>, useDockerfile: boolean,
    port: number, env: Record<string, string>, isPublic: boolean, dir = ''
): Promise<string> => {
    await ensureRepository(config);
    const image = imageFor(config, service);
    const build = useDockerfile
        ? [{ name: 'gcr.io/cloud-builders/docker', args: ['build', '-t', image, '.'], dir: dir || undefined },
           { name: 'gcr.io/cloud-builders/docker', args: ['push', image] }]
        : [{ name: 'gcr.io/k8s-skaffold/pack', entrypoint: 'pack', dir: dir || undefined,
             args: ['build', image, '--builder', 'gcr.io/buildpacks/builder:latest', '--publish'] }];
    const deploy = {
        name: 'gcr.io/google.com/cloudsdktool/cloud-sdk:slim', entrypoint: 'gcloud',
        args: ['run', 'deploy', service, '--image', image, '--region', config.region, '--port', String(port),
            ...(Object.keys(env).length ? ['--set-env-vars', Object.entries(env).map(([k, v]) => `${k}=${v}`).join(',')] : []),
            isPublic ? '--allow-unauthenticated' : '--no-allow-unauthenticated']
    };

    const op = await gfetch(config, `https://cloudbuild.googleapis.com/v1/projects/${config.account.project_id}/builds`, {
        method: 'POST',
        body: JSON.stringify({ source, steps: [...build, deploy], timeout: '1500s', options: { logging: 'CLOUD_LOGGING_ONLY' } })
    });
    const id = op?.metadata?.build?.id;
    return `Сборка запущена, build id: ${id}. Обычно 2–6 минут: поставьте паузу (wait_and_resume) и проверьте cloudrun_build_status.`;
};

const envArg = (value: unknown): Record<string, string> =>
    value && typeof value === 'object' ? Object.fromEntries(Object.entries(value as object).map(([k, v]) => [k, String(v)])) : {};

export const cloudRunTools = (load: () => Promise<GcpConfig>): ServerTool[] => {
    const common = {
        service: { type: 'string', description: 'Service name: lowercase letters, digits, dashes.' },
        port: { type: 'number', description: 'Port the app listens on (PORT env is set too). Default 8080.' },
        env: { type: 'object', description: 'Environment variables.', additionalProperties: { type: 'string' } },
        public: { type: 'boolean', description: 'Allow anyone to open the URL. Default true.' }
    };
    const pub = (a: any) => a.public !== false;

    return [
        {
            name: 'cloudrun_deploy_image',
            description: 'Deploy a ready container image to Google Cloud Run (the user\'s project).',
            inputSchema: { type: 'object', properties: { ...common, image: { type: 'string' } }, required: ['service', 'image'] },
            run: async a => deployImage(await load(), serviceName(a.service), String(a.image), Number(a.port) || 8080, envArg(a.env), pub(a))
        },
        {
            name: 'cloudrun_deploy_files',
            description: 'Build and deploy source files to Cloud Run. Include a Dockerfile to control the build; without one, buildpacks detect Node, Python, Go, Java etc. The app must listen on $PORT.',
            inputSchema: {
                type: 'object',
                properties: {
                    ...common,
                    files: { type: 'array', items: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } }
                },
                required: ['service', 'files']
            },
            run: async a => {
                const config = await load();
                const files = (Array.isArray(a.files) ? a.files : []).slice(0, 200).map((f: any) => ({ path: String(f.path), content: String(f.content ?? '') }));
                if (!files.length) throw new Error('Нет файлов');
                const service = serviceName(a.service);
                const bucket = `${config.account.project_id}_cloudbuild`;
                await gfetch(config, `https://storage.googleapis.com/storage/v1/b?project=${config.account.project_id}`,
                    { method: 'POST', body: JSON.stringify({ name: bucket, location: config.region }) }, [409]);
                const object = `potok/${service}-${Date.now()}.tar.gz`;
                const archive = await gzip(tarFiles(files));
                const r = await fetch(`https://storage.googleapis.com/upload/storage/v1/b/${bucket}/o?uploadType=media&name=${encodeURIComponent(object)}`, {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${await accessToken(config.account)}`, 'Content-Type': 'application/gzip' },
                    body: archive
                });
                if (!r.ok) throw new Error(`Не удалось загрузить исходники: ${r.status}`);
                const hasDockerfile = files.some((f: { path: string }) => /(^|\/)Dockerfile$/.test(f.path));
                return buildAndDeploy(config, service, { storageSource: { bucket, object } }, hasDockerfile,
                    Number(a.port) || 8080, envArg(a.env), pub(a));
            }
        },
        {
            name: 'cloudrun_deploy_github',
            description: 'Build and deploy a public GitHub repository (optionally a subfolder) to Cloud Run.',
            inputSchema: {
                type: 'object',
                properties: {
                    ...common,
                    repo: { type: 'string', description: 'https://github.com/owner/name' },
                    branch: { type: 'string' },
                    dir: { type: 'string', description: 'Subfolder with the app, if not the root.' },
                    dockerfile: { type: 'boolean', description: 'Build with the Dockerfile in that folder.' }
                },
                required: ['service', 'repo']
            },
            run: async a => {
                const url = String(a.repo).replace(/\/$/, '').replace(/(\.git)?$/, '.git');
                if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\.git$/.test(url)) throw new Error('Нужен адрес https://github.com/owner/name');
                return buildAndDeploy(await load(), serviceName(a.service),
                    { gitSource: { url, revision: String(a.branch || 'main'), dir: a.dir ? String(a.dir) : undefined } },
                    Boolean(a.dockerfile), Number(a.port) || 8080, envArg(a.env), pub(a));
            }
        },
        {
            name: 'cloudrun_build_status',
            description: 'Status of a Cloud Build started by a deploy tool, with the tail of its log on failure.',
            inputSchema: { type: 'object', properties: { build_id: { type: 'string' } }, required: ['build_id'] },
            run: async a => {
                const config = await load();
                const b = await gfetch(config, `https://cloudbuild.googleapis.com/v1/projects/${config.account.project_id}/builds/${encodeURIComponent(String(a.build_id))}`);
                const lines = [`status: ${b.status}`, b.statusDetail ? `detail: ${b.statusDetail}` : '', b.logUrl ? `log: ${b.logUrl}` : ''];
                if (b.status === 'WORKING' || b.status === 'QUEUED') lines.push('Ещё идёт — поставьте паузу и проверьте снова.');
                return lines.filter(Boolean).join('\n');
            }
        },
        {
            name: 'cloudrun_service_status',
            description: 'URL and readiness of a Cloud Run service.',
            inputSchema: { type: 'object', properties: { service: { type: 'string' } }, required: ['service'] },
            run: async a => {
                const config = await load();
                const s = await gfetch(config, `${runBase(config)}/${serviceName(a.service)}`);
                return [`url: ${s.uri || '(пока нет)'}`, `ready: ${s.terminalCondition?.state || s.conditions?.[0]?.state || '?'}`,
                    s.terminalCondition?.message ? `message: ${s.terminalCondition.message}` : '',
                    `revision: ${s.latestReadyRevision || '-'}`].filter(Boolean).join('\n');
            }
        },
        {
            name: 'cloudrun_list_services',
            description: 'List Cloud Run services in the region with their URLs.',
            inputSchema: { type: 'object', properties: {} },
            run: async () => {
                const config = await load();
                const data = await gfetch(config, `${runBase(config)}?pageSize=50`);
                const services = data.services || [];
                return services.length
                    ? services.map((s: any) => `- ${String(s.name).split('/').pop()}: ${s.uri}`).join('\n')
                    : 'Сервисов нет.';
            }
        },
        {
            name: 'cloudrun_delete_service',
            description: 'Delete a Cloud Run service. Irreversible.',
            inputSchema: { type: 'object', properties: { service: { type: 'string' } }, required: ['service'] },
            run: async a => {
                const config = await load();
                await gfetch(config, `${runBase(config)}/${serviceName(a.service)}`, { method: 'DELETE' });
                return `Сервис ${serviceName(a.service)} удаляется.`;
            }
        }
    ];
};
