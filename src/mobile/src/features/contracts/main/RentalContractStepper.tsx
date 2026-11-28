import React from 'react';
import { OnboardingStepper } from '../../../components/OnboardingStepper';
import { Box } from '../../../components/WorkspaceKit';
import { rentalContractSteps } from './rentalContractState';
import { MainContractProgress } from './MainContractProgress';

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
      {steps === rentalContractSteps ? (
        <MainContractProgress current={current + 4} />
      ) : (
        <OnboardingStepper steps={steps} current={current} completed={completed} />
      )}
    </Box>
  );
}
