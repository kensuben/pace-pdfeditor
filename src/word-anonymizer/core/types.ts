export type AnonymizerErrorCode =
  | 'TOO_LARGE'
  | 'ZIP_BOMB'
  | 'NOT_DOCX'
  | 'MACRO_ENABLED'
  | 'ENCRYPTED_OR_LEGACY'
  | 'INVALID_XML'

export class AnonymizerError extends Error {
  readonly code: AnonymizerErrorCode

  constructor(code: AnonymizerErrorCode, message: string) {
    super(message)
    this.name = 'AnonymizerError'
    this.code = code
  }
}

export type IdentityKind = 'contributor' | 'mentioned'

export interface KnownIdentity {
  author: string
  kind: IdentityKind
  initials?: string
  email?: string
  userId?: string
  sources: string[]
}

export interface InspectionStats {
  commentCount: number
  revisionCount: number
  authorCount: number
}

export type EntityKind = 'organization' | 'representative'

export interface CustomEntity {
  id: string
  kind: EntityKind
  label: string
  values: string[]
}

export type SensitiveKind =
  | 'email'
  | 'phone'
  | 'nationalId'
  | 'taxCode'
  | 'bankAccount'
  | 'address'

export interface SensitiveItem {
  kind: SensitiveKind
  value: string
  normalized: string
  count: number
}

export interface DeletedTextHit {
  kind: SensitiveKind | 'entity'
  count: number
  type?: 'entity' | 'sensitive'
  label?: string
  text?: string
  part?: string
}

export interface InspectionReport {
  identities: KnownIdentity[]
  stats: InspectionStats
  warnings: string[]
  hasMacro: boolean
  hasEmbeddings: boolean
  sensitive: SensitiveItem[]
  deletedTextHits: DeletedTextHit[]
}

export interface MappedIdentity {
  label: string
  initials: string
  alias: string
}

export type IdentityMapping = Record<string, MappedIdentity>

export type CustomPropsPolicy = 'keep-sensitivity-labels' | 'keep-all' | 'remove-all'

export type DeletedTextMode = 'mask' | 'remove' | 'keep'

export interface AnonymizeOptions {
  removeDates: boolean
  replaceMentions: boolean
  replaceNamesInCommentText: boolean
  scrubDocProps: boolean
  customPropsPolicy: CustomPropsPolicy
  customEntities?: CustomEntity[]
  maskKinds?: Partial<Record<SensitiveKind, boolean>>
  keepValues?: string[]
  deletedTextMode?: DeletedTextMode
}

export interface AnonymizeReplacements {
  entities: number
  byKind: Record<SensitiveKind, number>
  deletedRunsRemoved: number
}

export interface AnonymizeReport {
  identities: KnownIdentity[]
  mapping: IdentityMapping
  modifiedParts: string[]
  warnings: string[]
  replacements: AnonymizeReplacements
}

export interface AnonymizeResult {
  blob: Blob
  report: AnonymizeReport
}

export type ResidualCategory =
  | 'metadata'
  | 'comment-text'
  | 'body-text'
  | 'deleted-text'

export interface ResidualFinding {
  part: string
  matchedString: string
  count: number
  category: ResidualCategory
}

export interface ResidualReport {
  status: 'PASS' | 'WARN' | 'FAIL'
  findings: ResidualFinding[]
}
