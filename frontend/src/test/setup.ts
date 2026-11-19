import '@testing-library/jest-dom/vitest';
import { act, cleanup, configure } from '@testing-library/react';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach } from 'vitest';
import { ToastHost, clearToasts } from '../components/ToastHost';

configure({ asyncUtilTimeout: 4000 });

let toastPortal: HTMLDivElement | null = null;
let toastRoot: Root | null = null;

beforeEach(() => {
  clearToasts();
  toastPortal = document.createElement('div');
  document.body.appendChild(toastPortal);
  toastRoot = createRoot(toastPortal);
  act(() => {
    toastRoot?.render(createElement(ToastHost));
  });
});

afterEach(() => {
  clearToasts();
  if (toastRoot) {
    act(() => {
      toastRoot?.unmount();
    });
    toastRoot = null;
  }
  if (toastPortal) {
    toastPortal.remove();
    toastPortal = null;
  }
  cleanup();
});
