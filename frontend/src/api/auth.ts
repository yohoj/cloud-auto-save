import client from './client'

export interface LoginResult {
  success: boolean
  error?: string
}

export function login(username: string, password: string) {
  return client
    .post<LoginResult>('/api/auth/login', { username, password })
    .then((r) => r.data)
}

export function logout() {
  return client.post<LoginResult>('/api/auth/logout').then((r) => r.data)
}
