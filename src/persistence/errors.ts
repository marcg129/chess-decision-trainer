export class StorageUnavailableError extends Error {
  constructor(message = 'Browser storage is unavailable.') {
    super(message);
    this.name = 'StorageUnavailableError';
  }
}

export class StorageQuotaError extends Error {
  constructor(message = 'Browser storage quota was exceeded.') {
    super(message);
    this.name = 'StorageQuotaError';
  }
}

export class MigrationError extends Error {
  constructor(message = 'Training data migration failed.') {
    super(message);
    this.name = 'MigrationError';
  }
}

export class TransactionError extends Error {
  constructor(message = 'Training data transaction failed.') {
    super(message);
    this.name = 'TransactionError';
  }
}

export class InvalidBackupError extends Error {
  constructor(message = 'The selected backup is invalid.') {
    super(message);
    this.name = 'InvalidBackupError';
  }
}

export class UnsupportedBackupVersionError extends Error {
  constructor(message = 'The selected backup version is not supported.') {
    super(message);
    this.name = 'UnsupportedBackupVersionError';
  }
}

export class ReferentialIntegrityError extends Error {
  constructor(message = 'The selected backup contains broken references.') {
    super(message);
    this.name = 'ReferentialIntegrityError';
  }
}

export class RestoreError extends Error {
  constructor(message = 'Training data restore failed.') {
    super(message);
    this.name = 'RestoreError';
  }
}

export class ResetError extends Error {
  constructor(message = 'Training data reset failed.') {
    super(message);
    this.name = 'ResetError';
  }
}
