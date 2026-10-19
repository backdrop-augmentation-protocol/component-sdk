const ID = /^[a-z0-9][a-z0-9._-]{1,127}$/;
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

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
  const allowed = new Set(['protocol', 'id', 'name', 'version', 'implementationVersion', 'role', 'capabilities', 'permissions', 'modes', 'entrypoints', 'configScopes', 'description']);
  for (const key of Object.keys(value)) if (!allowed.has(key)) errors.push(`unknown field: ${key}`);
  if (!value.protocol || value.protocol.name !== 'bap' || typeof value.protocol.version !== 'string' || !VERSION.test(value.protocol.version) || typeof value.protocol.profile !== 'string') errors.push('protocol must be { name: bap, version, profile }');
  if (typeof value.id !== 'string' || !ID.test(value.id)) errors.push('id must be a lowercase package identifier');
  if (typeof value.name !== 'string' || !value.name.trim()) errors.push('name must be a non-empty string');
  if (typeof value.version !== 'string' || !VERSION.test(value.version)) errors.push('version must be semver-like (x.y.z)');
  if (value.role !== 'component') errors.push('role must be component');
  if (!Array.isArray(value.capabilities) || value.capabilities.some((item) => typeof item !== 'string')) errors.push('capabilities must be an array of strings');
  if (!Array.isArray(value.modes) || value.modes.length === 0 || value.modes.some((item) => !['embedded', 'standalone'].includes(item))) errors.push('modes must contain standalone and/or embedded');
  if (!value.entrypoints || typeof value.entrypoints !== 'object') errors.push('entrypoints is required');
  else {
    if (typeof value.entrypoints.default !== 'string' || !value.entrypoints.default.trim()) errors.push('entrypoints.default must be a non-empty path');
    for (const mode of value.modes || []) {
      if (typeof value.entrypoints[mode] !== 'string' || !value.entrypoints[mode].trim()) errors.push(`entrypoints.${mode} must be a non-empty path`);
    }
  }
  for (const field of ['permissions', 'configScopes']) {
    if (value[field] !== undefined && (!Array.isArray(value[field]) || value[field].some((item) => typeof item !== 'string'))) {
      errors.push(`${field} must be an array of strings`);
    }
  }
  if (Array.isArray(value.configScopes) && value.configScopes.some((item) => !['global', 'series', 'wallpaper', 'instance'].includes(item))) errors.push('configScopes contains an unsupported scope');
  return { valid: errors.length === 0, errors };
}

export function assertManifest(manifest) {
  const result = validateManifest(manifest);
  if (!result.valid) throw new ManifestValidationError(result.errors);
  return manifest;
}
