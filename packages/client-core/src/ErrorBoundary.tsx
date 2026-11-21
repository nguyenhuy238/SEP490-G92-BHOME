import { Component, type ReactNode } from 'react';

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed)
      return (
        <main role="alert">
          <h1>Đã xảy ra lỗi</h1>
          <p>Vui lòng tải lại trang để thử lại.</p>
          <button onClick={() => window.location.reload()}>Tải lại</button>
        </main>
      );
    return this.props.children;
  }
}
