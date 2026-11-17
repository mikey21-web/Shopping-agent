import { Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout.tsx';
import { Landing } from './pages/Landing.tsx';
import { Ask } from './pages/Ask.tsx';
import { Discover } from './pages/Discover.tsx';
import { ProductDetail } from './pages/ProductDetail.tsx';
import { Compare } from './pages/Compare.tsx';
import { Sources } from './pages/Sources.tsx';

export function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/ask" element={<Ask />} />
        <Route path="/discover" element={<Discover />} />
        <Route path="/product/:id" element={<ProductDetail />} />
        <Route path="/compare" element={<Compare />} />
        <Route path="/sources" element={<Sources />} />
        <Route path="*" element={<Landing />} />
      </Routes>
    </Layout>
  );
}
