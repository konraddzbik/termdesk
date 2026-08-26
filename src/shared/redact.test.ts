import { describe, expect, it } from 'vitest'
import { redactSecrets } from './redact'

describe('redactSecrets', () => {
  it('masks --password and -p values', () => {
    expect(redactSecrets('mysql -u root -phunter2 -h db')).toContain('-p«redacted»')
    expect(redactSecrets('tool --password s3cr3t')).toBe('tool --password «redacted»')
    expect(redactSecrets('tool --password=s3cr3t')).toBe('tool --password=«redacted»')
  })

  it('masks secret-looking env assignments but keeps the key', () => {
    expect(redactSecrets('AWS_SECRET_ACCESS_KEY=abc123 aws s3 ls')).toBe(
      'AWS_SECRET_ACCESS_KEY=«redacted» aws s3 ls',
    )
    expect(redactSecrets('export API_TOKEN=ghp_xxx')).toContain('API_TOKEN=«redacted»')
  })

  it('masks Authorization headers', () => {
    expect(redactSecrets('curl -H "Authorization: Bearer eyJ.abc.def" url')).toContain(
      'Authorization: Bearer «redacted»',
    )
  })

  it('masks AWS access key ids', () => {
    expect(redactSecrets('key AKIAIOSFODNN7EXAMPLE here')).toBe('key «redacted» here')
  })

  it('leaves ordinary commands untouched', () => {
    const cmd = 'kubectl get pods -n prod && docker ps -a'
    expect(redactSecrets(cmd)).toBe(cmd)
  })

  it('does not mask a non-secret env var', () => {
    expect(redactSecrets('NODE_ENV=production npm start')).toBe('NODE_ENV=production npm start')
  })

  it('redacts a password embedded in a URL, keeping scheme and user', () => {
    expect(
      redactSecrets('git clone https://deploy:ghp_realTokenValue@github.com/acme/infra.git'),
    ).toBe('git clone https://deploy:«redacted»@github.com/acme/infra.git')
    expect(redactSecrets('psql postgres://admin:s3cr3t@db.internal:5432/app')).toContain(
      'postgres://admin:«redacted»@db.internal',
    )
    // A URL with no userinfo is untouched.
    expect(redactSecrets('curl https://example.com/health')).toBe('curl https://example.com/health')
  })

  it('redacts -u user:pass style credentials', () => {
    expect(redactSecrets('curl -u admin:hunter2 https://api.example.com')).toBe(
      'curl -u admin:«redacted» https://api.example.com',
    )
    expect(redactSecrets('cmd --user svc:tokenvalue')).toBe('cmd --user svc:«redacted»')
  })

  it('redacts credential headers other than Authorization', () => {
    expect(redactSecrets("curl -H 'X-Api-Key: abc123def' https://x")).toContain(
      'X-Api-Key: «redacted»',
    )
    expect(redactSecrets('curl -H "Private-Token: glpat-xyz" https://gitlab')).toContain(
      'Private-Token: «redacted»',
    )
  })
})
