import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App.tsx';
import './index.css';

// تسجيل Service Worker وحيد عبر vite-plugin-pwa لتمكين فتح التطبيق بدون إنترنت
registerSW({
  immediate: true,
  onOfflineReady() {
    console.info('[PWA] التطبيق جاهز للعمل بدون إنترنت (Offline Ready).');
  },
  onRegisterError(error) {
    console.warn('[PWA] تعذر تسجيل Service Worker:', error);
  }
});

createRoot(document.getElementById('root')!).render(<App />);

