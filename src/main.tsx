import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import App from './App.tsx'
import { isUnauthorizedError } from './api/errors'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // A rejected token will never become accepted, so retrying one just
      // delays the error the player needs to see. Anything else gets the usual
      // couple of attempts.
      retry: (failureCount, error) => !isUnauthorizedError(error) && failureCount < 2,
      // This is a map tool, not a live dashboard; refetching every time the
      // window regains focus would be noise.
      refetchOnWindowFocus: false,
      staleTime: 60_000,
    },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
)
