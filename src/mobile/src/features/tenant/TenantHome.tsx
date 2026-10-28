import { roles, roleLabels } from '@bhome/client-core/roles.ts';
export function TenantHome() {
  return (
    <main>
      <h1>Không gian {roleLabels[roles.tenant].toLowerCase()}</h1>
      <p>Các tính năng sẽ được bổ sung tại đây.</p>
    </main>
  );
}
