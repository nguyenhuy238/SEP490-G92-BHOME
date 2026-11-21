// @vitest-environment jsdom
import React, { useCallback, useState } from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { WorkspaceFooter, WorkspaceFooterContext } from '../components/WorkspaceFooter';
afterEach(cleanup);
function Shell({ children }: { children: React.ReactNode }) {
  const [content, setContent] = useState<React.ReactNode>(null);
  const register = useCallback((node: React.ReactNode) => {
    setContent(node);
    return () => setContent(null);
  }, []);
  return (
    <WorkspaceFooterContext.Provider value={register}>
      <div data-testid="scroll-content">{children}</div>
      <footer>{content}</footer>
      <nav>Thanh điều hướng</nav>
    </WorkspaceFooterContext.Provider>
  );
}
it('places actions outside the scrolling content and removes them when leaving the workflow', () => {
  const view = render(
    <Shell>
      <WorkspaceFooter>
        <button>Tạo hợp đồng giữ chỗ</button>
      </WorkspaceFooter>
    </Shell>,
  );
  expect(within(screen.getByTestId('scroll-content')).queryByRole('button')).toBeNull();
  expect(within(screen.getByRole('contentinfo')).getByRole('button')).toBeTruthy();
  view.rerender(
    <Shell>
      <span>Màn hình khác</span>
    </Shell>,
  );
  expect(screen.queryByRole('button')).toBeNull();
});
it('keeps actions available when rendered without a workspace shell', () => {
  render(
    <WorkspaceFooter>
      <button>Quay lại</button>
    </WorkspaceFooter>,
  );
  expect(screen.getByRole('button', { name: 'Quay lại' })).toBeTruthy();
});
