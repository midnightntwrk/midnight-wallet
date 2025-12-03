import { createMemoryRouter, Navigate } from 'react-router-dom'
import { MainLayout } from './layouts/main-layout'
import { UnlockPage } from './pages/unlock'
import { HomePage } from './pages/home'
import { SendPage } from './pages/send'
import { ReceivePage } from './pages/receive'
import { SettingsPage } from './pages/settings'
import { ConnectedDappsPage } from './pages/settings/connected-dapps'
import { ExportSeedPage } from './pages/settings/export-seed'
import { WelcomePage } from './pages/onboarding/welcome'
import { CreateWalletPage } from './pages/onboarding/create-wallet'
import { ImportWalletPage } from './pages/onboarding/import-wallet'
import { BackupSeedPage } from './pages/onboarding/backup-seed'
import { ConfirmSeedPage } from './pages/onboarding/confirm-seed'
import { SetPasswordPage } from './pages/onboarding/set-password'
import {
  ApproveConnectionPage,
  ApproveTransactionPage,
  ApproveMessagePage,
} from './pages/approve'

function getInitialRoute(): string {
  const hash = window.location.hash
  if (hash.includes('/approve/')) {
    return hash.replace('#', '')
  }
  return '/unlock'
}

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
      { path: 'settings/connected-dapps', element: <ConnectedDappsPage /> },
      { path: 'settings/export-seed', element: <ExportSeedPage /> },
      { path: 'welcome', element: <WelcomePage /> },
      { path: 'create-wallet', element: <CreateWalletPage /> },
      { path: 'import-wallet', element: <ImportWalletPage /> },
      { path: 'backup-seed', element: <BackupSeedPage /> },
      { path: 'confirm-seed', element: <ConfirmSeedPage /> },
      { path: 'set-password', element: <SetPasswordPage /> },
      { path: 'approve/connect', element: <ApproveConnectionPage /> },
      { path: 'approve/transaction', element: <ApproveTransactionPage /> },
      { path: 'approve/message', element: <ApproveMessagePage /> },
    ],
  },
], {
  initialEntries: [getInitialRoute()],
})
