import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import { ProfileProvider } from './lib/profile'
import Backtesting from './pages/Backtesting'
import Builder from './pages/Builder'
import Explorer from './pages/Explorer'
import Methodology from './pages/Methodology'
import ModelPerformance from './pages/ModelPerformance'
import Overview from './pages/Overview'
import Predictor from './pages/Predictor'

export default function App() {
  return (
    <ProfileProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Overview />} />
            <Route path="predictor" element={<Predictor />} />
            <Route path="explorer" element={<Explorer />} />
            <Route path="explorer/:ticker" element={<Explorer />} />
            <Route path="builder" element={<Builder />} />
            <Route path="backtesting" element={<Backtesting />} />
            <Route path="models" element={<ModelPerformance />} />
            <Route path="methodology" element={<Methodology />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </ProfileProvider>
  )
}
