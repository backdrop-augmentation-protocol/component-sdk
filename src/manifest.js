export const MANIFEST_VERSION = '0.1';

const ID = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const VERSION = /^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$/;

export class ManifestValidationError extends Error {
  constructor(errors) {
    super(`Invalid BAP component manifest: ${errors.join('; ')}`);
    this.name = 'ManifestValidationError';
    this.errors = errors;
  }
}

export function validateManifest(value) {
  const errors = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { valid: false, errors: ['manifest must be an object'] };
  }
  if (value.manifestVersion !== MANIFEST_VERSION) errors.push(`manifestVersion must be ${MANIFEST_VERSION}`);
  if (typeof value.id !== 'string' || !ID.test(value.id)) errors.push('id must be a lowercase package identifier');
  if (typeof value.name !== 'string' || !value.name.trim()) errors.push('name must be a non-empty string');
  if (typeof value.version !== 'string' || !VERSION.test(value.version)) errors.push('version must be semver-like (x.y.z)');
  if (!value.entry || typeof value.entry !== 'object') errors.push('entry is required');
  else {
    for (const mode of ['embedded', 'standalone']) {
      if (typeof value.entry[mode] !== 'string' || !value.entry[mode].trim()) errors.push(`entry.${mode} must be a non-empty path`);
    }
  }
  for (const field of ['capabilities', 'permissions']) {
    if (value[field] !== undefined && (!Array.isArray(value[field]) || value[field].some((item) => typeof item !== 'string'))) {
      errors.push(`${field} must be an array of strings`);
    }
  }
  if (value.configSchema !== undefined && (typeof value.configSchema !== 'object' || value.configSchema === null || Array.isArray(value.configSchema))) {
    errors.push('configSchema must be a JSON Schema object');
  }
  return { valid: errors.length === 0, errors };
}

export function assertManifest(manifest) {
  const result = validateManifest(manifest);
  if (!result.valid) throw new ManifestValidationError(result.errors);
  return manifest;
}
