import { roles, roleLabels } from '@bhome/client-core/roles.ts';
export function StaffHome() {
  return (
    <main>
      <h1>Không gian {roleLabels[roles.staff].toLowerCase()}</h1>
      <p>Các tính năng sẽ được bổ sung tại đây.</p>
    </main>
  );
}
