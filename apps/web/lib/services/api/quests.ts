import { apiFetch } from './client';
import type { Quest } from '@/lib/quest-types';

export interface DashboardStats {
  totalPoints: number;
  questsCompleted: number;
  txCount: number;
  weeklyRank: number;
}

export interface ActivityItem {
  type: 'quest_completed' | 'task_verified' | 'cc_transfer';
  title: string;
  detail: string;
  time: string;
}

export interface MyProgress {
  completedQuestIds: string[];
  submittedTaskIds: string[];
}

export function listQuests() {
  return apiFetch<Quest[]>('/api/quests');
}

export function getMyProgress() {
  return apiFetch<MyProgress>('/api/quests/my-progress');
}

export function getDashboardStats() {
  return apiFetch<DashboardStats>('/api/quests/dashboard-stats');
}

export function getActivity(limit = 8) {
  return apiFetch<ActivityItem[]>(`/api/quests/activity?limit=${limit}`);
}

export function getLeaderboard(period: string, page: number, pageSize: number) {
  return apiFetch(
    `/api/quests/leaderboard?period=${period}&page=${page}&pageSize=${pageSize}`,
  );
}

export function getQuestProgress(questId: string) {
  return apiFetch(`/api/quests/${questId}/progress`);
}

export function submitQuestTask(questId: string, taskId: string, proof?: string) {
  return apiFetch(`/api/quests/${questId}/tasks/${taskId}/submit`, {
    method: 'POST',
    json: proof ? { proof } : {},
  });
}

export function submitQuest(questId: string) {
  return apiFetch(`/api/quests/${questId}/submit`, { method: 'POST' });
}

export function getRewardStatus(questId: string) {
  return apiFetch(`/api/quests/${questId}/reward-status`);
}
