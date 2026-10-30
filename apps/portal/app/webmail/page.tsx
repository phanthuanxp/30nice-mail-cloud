import type { Metadata } from 'next';
import WebmailClient from './webmail-client';
import './webmail.css';
import './webmail-fixes.css';
import './webmail-search.css';

export const metadata: Metadata = {
  title: '30NICE Mail — Hộp thư doanh nghiệp',
  description: 'Đăng nhập, đọc và gửi email doanh nghiệp với 30NICE Mail.',
};

export default function WebmailPage() { return <WebmailClient />; }
