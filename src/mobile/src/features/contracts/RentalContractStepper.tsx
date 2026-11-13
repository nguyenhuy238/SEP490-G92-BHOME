import React from 'react';
import { OnboardingStepper } from '../../components/OnboardingStepper';
import { Box } from '../../components/WorkspaceKit';
import { rentalContractSteps } from './rentalContractState';

export function RentalContractStepper({
  current,
  completed = [],
  steps = rentalContractSteps,
}: {
  current: number;
  completed?: readonly string[];
  steps?: readonly { key: string; label: string }[];
}) {
  return (
    <Box>
      <OnboardingStepper steps={steps} current={current} completed={completed} />
    </Box>
  );
}
