import React from 'react';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { Page } from '../components/Controls';
import { useSession } from '../lib/SessionProvider';
import { IdentityWizard } from '../features/onboarding/IdentityWizard';
export default function IdentityScreen() {
  const { residentId } = useLocalSearchParams<{ residentId: string }>();
  const { api, session } = useSession();
  if (!api || !session || !residentId) return <Redirect href="/" />;
  return (
    <Page>
      <IdentityWizard
        residentId={residentId}
        onComplete={() => router.replace('/capture')}
        onCancel={() => router.back()}
      />
    </Page>
  );
}
