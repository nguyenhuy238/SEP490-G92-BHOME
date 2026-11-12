import React from 'react';
import { OnboardingStepper } from '../../components/OnboardingStepper';
import { Box } from '../../components/WorkspaceKit';
import { rentalContractSteps } from './rentalContractState';

export function RentalContractStepper({
  current,
  completed = [],
}: {
  current: number;
  completed?: readonly string[];
}) {
  return (
    <Box>
      <OnboardingStepper steps={rentalContractSteps} current={current} completed={completed} />
    </Box>
  );
}
