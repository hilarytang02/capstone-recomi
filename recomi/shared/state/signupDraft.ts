type SignupDraft = {
  email: string
  password: string
  confirmPassword: string
}

let draft: SignupDraft | null = null

export function setSignupDraft(next: SignupDraft): void {
  draft = next
}

export function getSignupDraft(): SignupDraft | null {
  return draft
}

export function clearSignupDraft(): void {
  draft = null
}
