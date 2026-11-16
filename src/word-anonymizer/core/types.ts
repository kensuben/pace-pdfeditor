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

export interface KnownIdentity {
  author: string
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

export interface InspectionReport {
  identities: KnownIdentity[]
  stats: InspectionStats
  warnings: string[]
  hasMacro: boolean
  hasEmbeddings: boolean
}

export interface MappedIdentity {
  label: string
  initials: string
}

export type IdentityMapping = Record<string, MappedIdentity>

export type CustomPropsPolicy = 'keep-sensitivity-labels' | 'keep-all' | 'remove-all'

export interface AnonymizeOptions {
  removeDates: boolean
  replaceMentions: boolean
  replaceNamesInCommentText: boolean
  scrubDocProps: boolean
  customPropsPolicy: CustomPropsPolicy
}

export interface AnonymizeReport {
  identities: KnownIdentity[]
  mapping: IdentityMapping
  modifiedParts: string[]
  warnings: string[]
}

export interface AnonymizeResult {
  blob: Blob
  report: AnonymizeReport
}

export type ResidualCategory = 'metadata' | 'comment-text' | 'body-text'

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
