import { useQuery } from '@tanstack/react-query';
import type { CostSummary } from '@career/shared';
import { api } from '../api/client';
import { Card, Spinner } from '../components/ui';

export function CostsPage() {
  const summary = useQuery({
    queryKey: ['costs'],
    queryFn: async () => (await api.get<CostSummary>('/costs/summary')).data,
    refetchInterval: 30_000,
  });

  if (summary.isLoading) return <Spinner />;
  const s = summary.data;

  return (
    <div className="page">
      <div className="page-head">
        <h2>LLM cost dashboard</h2>
      </div>
      {s === undefined ? (
        <Card>
          <p className="muted">No LLM usage recorded yet.</p>
        </Card>
      ) : (
        <>
          <div className="stats-row">
            <Card>
              <div className="stat-value">${s.totalCostUsd.toFixed(4)}</div>
              <div className="muted">total spend</div>
            </Card>
            <Card>
              <div className="stat-value">{s.totalCalls}</div>
              <div className="muted">LLM calls</div>
            </Card>
            <Card>
              <div className="stat-value">{(s.totalTokensIn + s.totalTokensOut).toLocaleString()}</div>
              <div className="muted">tokens</div>
            </Card>
          </div>
          <Card>
            <h3>By purpose</h3>
            <table className="table">
              <thead>
                <tr>
                  <th>purpose</th>
                  <th>calls</th>
                  <th>tokens in</th>
                  <th>tokens out</th>
                  <th>cost</th>
                </tr>
              </thead>
              <tbody>
                {s.byPurpose.map((p) => (
                  <tr key={p.purpose}>
                    <td>{p.purpose}</td>
                    <td>{p.calls}</td>
                    <td>{p.tokensIn.toLocaleString()}</td>
                    <td>{p.tokensOut.toLocaleString()}</td>
                    <td>${p.costUsd.toFixed(4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </div>
  );
}
