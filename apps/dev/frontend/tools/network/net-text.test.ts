import { describe, expect, it } from 'vitest';
import { curlOf, headersOf, hostAndPort, statusKind, syntaxOf } from './net-text';

describe('headers as they are typed', () => {
  it('are a name and a value to a line', () => {
    expect(headersOf('Accept: application/json\n\n  X-Token:  a:b  \n# not this one\nEmpty:')).toEqual({ pairs: [['Accept', 'application/json'], ['X-Token', 'a:b'], ['Empty', '']], bad: null });
    expect(headersOf('')).toEqual({ pairs: [], bad: null });
  });

  it('tell the first line that is no header', () => {
    expect(headersOf('Accept: */*\nnot a header\nX: 1')).toEqual({ pairs: [['Accept', '*/*']], bad: 'not a header' });
    expect(headersOf(': value').bad).toBe(': value');
  });
});

describe('a request as a command of curl', () => {
  const request = { method: 'GET', url: 'https://example.com/a?b=1&c=2', headers: [], body: '', follow: false, verifyTls: true };

  it('is the address alone for a plain GET', () => {
    expect(curlOf(request)).toBe("curl 'https://example.com/a?b=1&c=2'");
  });

  it('carries the method, the headers, the body and the choices', () => {
    expect(curlOf({ ...request, method: 'POST', headers: [['Content-Type', 'application/json']], body: '{"a":"it\'s"}', follow: true, verifyTls: false })).toBe(
      "curl -X POST 'https://example.com/a?b=1&c=2' -H 'Content-Type: application/json' --data-raw '{\"a\":\"it'\\''s\"}' -L -k",
    );
    expect(curlOf({ ...request, method: 'DELETE' })).toBe("curl -X DELETE 'https://example.com/a?b=1&c=2'");
    expect(curlOf({ ...request, method: 'PUT', body: 'not this', bodyFile: '/tmp/a b.bin' })).toBe("curl -X PUT 'https://example.com/a?b=1&c=2' --data-binary '@/tmp/a b.bin'");
  });
});

describe('what an answer is', () => {
  it('is told by the kind it says it is', () => {
    expect(syntaxOf('application/json; charset=utf-8')).toBe('json');
    expect(syntaxOf('application/problem+json')).toBe('json');
    expect(syntaxOf('TEXT/HTML')).toBe('html');
    expect(syntaxOf('image/svg+xml')).toBe('xml');
    expect(syntaxOf('application/yaml')).toBe('yaml');
    expect(syntaxOf('text/plain')).toBeUndefined();
    expect(syntaxOf(undefined)).toBeUndefined();
  });

  it('stands well or not by its number', () => {
    expect([100, 200, 204, 301, 404, 503].map(statusKind)).toEqual(['told', 'fine', 'fine', 'moved', 'wrong', 'wrong']);
  });
});

describe('the host and the port of what is typed', () => {
  it('are a name with a port or without', () => {
    expect(hostAndPort('example.com', 443)).toEqual({ host: 'example.com', port: 443 });
    expect(hostAndPort(' example.com:8443 ', 443)).toEqual({ host: 'example.com', port: 8443 });
    expect(hostAndPort('10.0.0.1:22', 443)).toEqual({ host: '10.0.0.1', port: 22 });
    expect(hostAndPort('example.com/path', 443)).toEqual({ host: 'example.com', port: 443 });
  });

  it('are taken from a whole address', () => {
    expect(hostAndPort('https://example.com/a/b?c', 443)).toEqual({ host: 'example.com', port: 443 });
    expect(hostAndPort('https://example.com:9443/', 443)).toEqual({ host: 'example.com', port: 9443 });
    expect(hostAndPort('http://example.com', 443)).toEqual({ host: 'example.com', port: 80 });
  });

  it('read an IPv6 address by its brackets', () => {
    expect(hostAndPort('[::1]:8443', 443)).toEqual({ host: '::1', port: 8443 });
    expect(hostAndPort('[2001:db8::1]', 443)).toEqual({ host: '2001:db8::1', port: 443 });
    expect(hostAndPort('2001:db8::1', 443)).toEqual({ host: '2001:db8::1', port: 443 });
  });

  it('are nothing when there is no host or the port is none', () => {
    expect(hostAndPort('', 443)).toBeNull();
    expect(hostAndPort(':443', 443)).toBeNull();
    expect(hostAndPort('example.com:http', 443)).toBeNull();
    expect(hostAndPort('example.com:70000', 443)).toBeNull();
  });
});
