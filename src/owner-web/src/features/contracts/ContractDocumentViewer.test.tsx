import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { ContractDocumentViewer } from './components/signing/ContractDocumentViewer';
import { contractPdfName } from '../../../../../packages/client-core/src/contractPdfName';

afterEach(cleanup);

it('keeps the same document source for review, fullscreen, download and print', async () => {
  const url = 'blob:synthetic-contract';
  const filename = contractPdfName('Holding', 'HD-001');
  render(<ContractDocumentViewer url={url} title="PDF kiểm thử" filename={filename} />);
  expect(screen.getByTitle('PDF kiểm thử')).toHaveAttribute('src', url);
  expect(screen.getByRole('link', { name: 'Tải PDF' })).toHaveAttribute('download', filename);
  expect(screen.getByRole('link', { name: 'Tải PDF' })).toHaveAttribute('href', url);
  expect(screen.getByRole('link', { name: 'Mở PDF để in' })).toHaveAttribute('href', url);
  fireEvent.click(screen.getByRole('button', { name: 'Toàn màn hình' }));
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByTitle('PDF kiểm thử')).toHaveAttribute('src', url);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Thoát toàn màn hình' }));
  expect(screen.getByTitle('PDF kiểm thử')).toHaveAttribute('src', url);
});

it('uses a safe file name with the correct document type', () => {
  expect(contractPdfName('Holding', 'HD-001')).toBe('Hop-dong-dat-coc-HD-001.pdf');
  expect(contractPdfName('Main', '../HD/001')).toBe('Hop-dong-thue-phong----HD-001.pdf');
  expect(contractPdfName('Addendum', 'PL-1')).toBe('Phu-luc-hop-dong-PL-1.pdf');
});
