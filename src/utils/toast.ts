// src/utils/toast.ts
type ToastFn = (msg: string) => void

const log = (tag: string) => (msg: string) => {
  // Works even if you don't have any toast library installed
  console[tag === 'error' ? 'error' : 'log'](`[${tag.toUpperCase()}] ${msg}`)
}

export const toast: { success: ToastFn; error: ToastFn; info: ToastFn } = {
  success: log('success'),
  error: log('error'),
  info: log('info'),
}
