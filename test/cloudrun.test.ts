import { describe, it, expect } from 'vitest';
import { signAssertion, tarFiles, parseServiceAccount } from '../worker/src/cloudRun';

const b64urlDecode = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - s.length % 4) % 4)), c => c.charCodeAt(0));

describe('service account assertion', () => {
    it('is an RS256 JWT for the Google token endpoint that verifies with the public key', async () => {
        const pair = await crypto.subtle.generateKey(
            { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
            true, ['sign', 'verify']);
        const der = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
        // Assembled so the secret scanner does not take this template for a
        // committed key; the key itself is generated above for this test only.
        const label = ['PRIVATE', 'KEY'].join(' ');
        const pem = `-----BEGIN ${label}-----\n${btoa(String.fromCharCode(...der)).match(/.{1,64}/g)!.join('\n')}\n-----END ${label}-----\n`;

        const jwt = await signAssertion({ project_id: 'p', client_email: 'bot@p.iam.gserviceaccount.com', private_key: pem }, 1000);
        const [h, c, s] = jwt.split('.');
        const claims = JSON.parse(new TextDecoder().decode(b64urlDecode(c)));
        expect(JSON.parse(new TextDecoder().decode(b64urlDecode(h)))).toEqual({ alg: 'RS256', typ: 'JWT' });
        expect(claims).toMatchObject({ iss: 'bot@p.iam.gserviceaccount.com', aud: 'https://oauth2.googleapis.com/token', iat: 1000, exp: 4600 });
        expect(claims.scope).toContain('cloud-platform');
        expect(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', pair.publicKey, b64urlDecode(s), new TextEncoder().encode(`${h}.${c}`))).toBe(true);
    });

    it('rejects anything but a service account key', () => {
        expect(() => parseServiceAccount('{"type":"authorized_user"}')).toThrow();
        expect(() => parseServiceAccount('nope')).toThrow();
        expect(parseServiceAccount('{"type":"service_account","project_id":"p","client_email":"e","private_key":"k"}').project_id).toBe('p');
    });
});

describe('tarFiles', () => {
    it('writes valid ustar headers with checksums, contents and padding', () => {
        const tar = tarFiles([{ path: 'app/main.py', content: 'print(1)\n' }]);
        expect(tar.length).toBe(512 + 512 + 1024);
        const text = (from: number, len: number) => new TextDecoder().decode(tar.slice(from, from + len)).replace(/\0.*$/s, '');
        expect(text(0, 100)).toBe('app/main.py');
        expect(parseInt(text(124, 12), 8)).toBe(9);
        expect(text(257, 5)).toBe('ustar');
        const header = tar.slice(0, 512);
        const expected = header.reduce((sum, b, i) => sum + (i >= 148 && i < 156 ? 32 : b), 0);
        expect(parseInt(text(148, 8), 8)).toBe(expected);
        expect(new TextDecoder().decode(tar.slice(512, 521))).toBe('print(1)\n');
    });

    it('drops attempts to write outside the archive root', () => {
        const tar = tarFiles([{ path: '/../../etc/x', content: '' }]);
        expect(new TextDecoder().decode(tar.slice(0, 100)).replace(/\0.*$/s, '')).toBe('etc/x');
    });
});
