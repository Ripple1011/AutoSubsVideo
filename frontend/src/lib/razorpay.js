/**
 * Lazy-load Razorpay Checkout SDK on first use. Single-flight: once loaded,
 * any subsequent call resolves immediately. The SDK attaches `window.Razorpay`.
 *
 * We don't bundle this -- Razorpay updates Checkout periodically and the
 * official guidance is to load from their CDN every time. ~30 KB gzipped.
 */
const SDK_URL = 'https://checkout.razorpay.com/v1/checkout.js'
let loaderPromise = null

export function loadRazorpaySDK() {
  if (typeof window === 'undefined') return Promise.resolve(false)
  if (window.Razorpay) return Promise.resolve(true)
  if (loaderPromise) return loaderPromise
  loaderPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = SDK_URL
    s.async = true
    s.onload = () => resolve(true)
    s.onerror = () => {
      loaderPromise = null
      reject(new Error('Failed to load Razorpay Checkout.'))
    }
    document.head.appendChild(s)
  })
  return loaderPromise
}
