import { useState } from 'react';
import { createJob } from '../api';

export function NewJob() {
  const [repoPath, setRepoPath] = useState('');
  const [request, setRequest] = useState('');
  const [branchName, setBranchName] = useState('');
  const [maxRounds, setMaxRounds] = useState(3);
  const [plannerModel, setPlannerModel] = useState('azure-custom/gpt-4.1');
  const [coderModel, setCoderModel] = useState('it-olama/qwen2.5:14b-instruct');
  const [reviewerModel, setReviewerModel] = useState('azure-custom/gpt-4.1-mini');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const { job } = await createJob({ repoPath, request, branchName: branchName || undefined, maxRounds, plannerModel, coderModel, reviewerModel });
      window.location.href = `/jobs/${job.id}`;
    } catch (err) {
      setError(String(err));
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: 600 }}>
      <h2>New Job</h2>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <label>Repository Path <input value={repoPath} onChange={(e) => setRepoPath(e.target.value)} required style={{ width: '100%' }} /></label>
        <label>Coding Request <textarea value={request} onChange={(e) => setRequest(e.target.value)} required rows={4} style={{ width: '100%' }} /></label>
        <label>Branch Name (optional) <input value={branchName} onChange={(e) => setBranchName(e.target.value)} style={{ width: '100%' }} /></label>
        <label>Max Rounds <input type="number" value={maxRounds} onChange={(e) => setMaxRounds(Number(e.target.value))} min={1} max={10} style={{ width: 100 }} /></label>
        <label>Planner Model <input value={plannerModel} onChange={(e) => setPlannerModel(e.target.value)} style={{ width: '100%' }} /></label>
        <label>Coder Model <input value={coderModel} onChange={(e) => setCoderModel(e.target.value)} style={{ width: '100%' }} /></label>
        <label>Reviewer Model <input value={reviewerModel} onChange={(e) => setReviewerModel(e.target.value)} style={{ width: '100%' }} /></label>
        {error && <div style={{ color: 'red' }}>Error: {error}</div>}
        <button type="submit" disabled={loading} style={{ padding: '8px 16px' }}>{loading ? 'Submitting...' : 'Run'}</button>
      </form>
    </div>
  );
}
