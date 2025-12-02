import { createMemoryRouter, Navigate } from 'react-router-dom'
import { MainLayout } from './layouts/main-layout'
import { UnlockPage } from './pages/unlock'
import { HomePage } from './pages/home'
import { SendPage } from './pages/send'
import { ReceivePage } from './pages/receive'
import { SettingsPage } from './pages/settings'

export const router = createMemoryRouter([
  {
    path: '/',
    element: <MainLayout />,
    children: [
      { index: true, element: <Navigate to="/unlock" replace /> },
      { path: 'unlock', element: <UnlockPage /> },
      { path: 'home', element: <HomePage /> },
      { path: 'send', element: <SendPage /> },
      { path: 'receive', element: <ReceivePage /> },
      { path: 'settings', element: <SettingsPage /> },
    ],
  },
])
