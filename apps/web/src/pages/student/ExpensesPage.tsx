import { useMemo, useState, useEffect, useCallback } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { PageHeader } from '../../components/ui';
import { api, asItems, errorMessage } from '../../lib/api';
import type { Booking } from '../../types';
import { WalletCards } from 'lucide-react';

interface ExpenseData {
  date: string;
  amount: number;
}

export function ExpensesPage() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      // Fetch up to 1000 recent bookings to generate meaningful charts
      const data = asItems<Booking>(await api.get<unknown>('/student/bookings?pageSize=1000'));
      setBookings(data);
    } catch (reason) {
      setError(errorMessage(reason, 'Could not load booking history.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const { chartData, totalSpent } = useMemo(() => {
    // Only count successful/paid bookings
    const successfulBookings = bookings.filter((b) => 
      ['CONFIRMED', 'CHECKED_IN', 'COMPLETED'].includes(b.status) || b.paymentStatus === 'SUCCESS'
    );

    const totalSpent = successfulBookings.reduce((sum, b) => sum + (b.totalAmount || 0), 0);

    // Group by YYYY-MM-DD
    const grouped = successfulBookings.reduce((acc, booking) => {
      const date = new Date(booking.createdAt).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
      });
      acc[date] = (acc[date] || 0) + (booking.totalAmount || 0);
      return acc;
    }, {} as Record<string, number>);

    // Convert to array and sort (assuming the keys are roughly chronologically ordered by the nature of the API response, but let's reverse to show oldest to newest)
    const chartData: ExpenseData[] = Object.entries(grouped)
      .map(([date, amount]) => ({ date, amount }))
      .reverse();

    return { chartData, totalSpent };
  }, [bookings]);

  return (
    <div className="page-stack">
      <PageHeader
        description="Track your spending on bus trips over time."
        eyebrow="Analytics"
        title="My expenses"
      />
      {error && <div className="alert alert--danger">{error}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '24px' }}>
        <div className="stat-card" style={{ padding: '24px', background: 'var(--surface)', borderRadius: '12px', border: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
            <WalletCards size={24} style={{ color: 'var(--primary)' }} />
            <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 600 }}>Total spent</h3>
          </div>
          <p style={{ margin: 0, fontSize: '2.5rem', fontWeight: 700, color: 'var(--text)' }}>
            ৳{totalSpent.toFixed(2)}
          </p>
        </div>
      </div>

      <div style={{ padding: '24px', background: 'var(--surface)', borderRadius: '12px', border: '1px solid var(--border)', marginTop: '24px' }}>
        <h3 style={{ margin: '0 0 24px', fontSize: '1.1rem', fontWeight: 600 }}>Spending over time</h3>
        {loading ? (
          <div style={{ height: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
            Loading expenses data...
          </div>
        ) : chartData.length > 0 ? (
          <div style={{ height: 350, width: '100%' }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 20, right: 20, left: 0, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                <XAxis 
                  dataKey="date" 
                  tick={{ fill: 'var(--text-muted)' }} 
                  axisLine={{ stroke: 'var(--border)' }}
                  tickLine={false}
                  dy={10}
                />
                <YAxis 
                  tickFormatter={(value) => `৳${value}`}
                  tick={{ fill: 'var(--text-muted)' }}
                  axisLine={{ stroke: 'var(--border)' }}
                  tickLine={false}
                  dx={-10}
                />
                <Tooltip 
                  cursor={{ fill: 'var(--surface-sunken)' }}
                  contentStyle={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)', borderRadius: '8px', color: 'var(--text)' }}
                  formatter={(value: any) => [`৳${Number(value).toFixed(2)}`, 'Spent']}
                  labelStyle={{ color: 'var(--text-muted)', marginBottom: '8px' }}
                />
                <Bar 
                  dataKey="amount" 
                  fill="var(--primary)" 
                  radius={[4, 4, 0, 0]} 
                  maxBarSize={50}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div style={{ height: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
            No expenses found. Book a trip to see your analytics!
          </div>
        )}
      </div>
    </div>
  );
}
