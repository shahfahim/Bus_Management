import React from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

export interface ChartData {
  label: string;
  value: number;
}

export type ChartType = 'bar' | 'line' | 'pie';

interface ChartConfig {
  valueKind?: 'number' | 'currency' | 'percent';
  height?: number;
  primaryColor?: string;
  gridColor?: string;
  axisColor?: string;
}

// --- FACTORY PATTERN ---
// The ChartFactory encapsulates the creation of complex Recharts components,
// providing a simple, unified interface for the rest of the application.
export class ChartFactory {
  // Default professional colors as requested: Deep Indigo primary, Slate Gray neutral axes/grids.
  private static DEFAULT_PRIMARY = '#4F46E5';
  private static DEFAULT_GRID = '#334155'; // Dark slate for subtle grid
  private static DEFAULT_AXIS = '#94A3B8'; // Lighter slate for axis text

  // Helper to format values consistently across tooltips and axes
  private static formatValue(value: number, kind: ChartConfig['valueKind'] = 'number'): string {
    if (kind === 'currency') {
      return new Intl.NumberFormat('en-BD', { style: 'currency', currency: 'BDT', maximumFractionDigits: 0 }).format(value);
    }
    if (kind === 'percent') {
      return `${value.toFixed(1)}%`;
    }
    return new Intl.NumberFormat('en-BD').format(value);
  }

  // The Factory Method
  public static createChart(type: ChartType, data: ChartData[], config: ChartConfig = {}): React.ReactElement {
    const {
      height = 300,
      valueKind = 'number',
      primaryColor = this.DEFAULT_PRIMARY,
      gridColor = this.DEFAULT_GRID,
      axisColor = this.DEFAULT_AXIS,
    } = config;

    if (!data || data.length === 0) {
      return (
        <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: axisColor }}>
          No data available for this period.
        </div>
      );
    }

    switch (type) {
      case 'bar':
        return this.createBarChart(data, height, valueKind, primaryColor, gridColor, axisColor);
      case 'line':
        return this.createLineChart(data, height, valueKind, primaryColor, gridColor, axisColor);
      case 'pie':
        return this.createPieChart(data, height, valueKind, primaryColor);
      default:
        throw new Error(`Unsupported chart type: ${type}`);
    }
  }

  private static createBarChart(
    data: ChartData[],
    height: number,
    valueKind: ChartConfig['valueKind'],
    primaryColor: string,
    gridColor: string,
    axisColor: string
  ): React.ReactElement {
    return (
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} margin={{ top: 20, right: 20, left: 20, bottom: 20 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
          <XAxis 
            dataKey="label" 
            stroke={axisColor} 
            tick={{ fill: axisColor, fontSize: 12 }} 
            tickLine={false} 
            axisLine={false} 
          />
          <YAxis 
            stroke={axisColor} 
            tick={{ fill: axisColor, fontSize: 12 }} 
            tickLine={false} 
            axisLine={false}
            tickFormatter={(value: number) => this.formatValue(value, valueKind)} 
          />
          <Tooltip 
            cursor={{ fill: 'rgba(255, 255, 255, 0.05)' }} 
            contentStyle={{ backgroundColor: '#1E293B', borderColor: gridColor, borderRadius: '8px', color: '#F8FAFC' }}
            itemStyle={{ color: '#F8FAFC' }}
            formatter={(value: any) => [this.formatValue(Number(value) || 0, valueKind), 'Value']} 
          />
          <Bar dataKey="value" fill={primaryColor} radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    );
  }

  private static createLineChart(
    data: ChartData[],
    height: number,
    valueKind: ChartConfig['valueKind'],
    primaryColor: string,
    gridColor: string,
    axisColor: string
  ): React.ReactElement {
    return (
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 20, right: 20, left: 20, bottom: 20 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
          <XAxis 
            dataKey="label" 
            stroke={axisColor} 
            tick={{ fill: axisColor, fontSize: 12 }} 
            tickLine={false} 
            axisLine={false} 
          />
          <YAxis 
            stroke={axisColor} 
            tick={{ fill: axisColor, fontSize: 12 }} 
            tickLine={false} 
            axisLine={false}
            tickFormatter={(value: number) => this.formatValue(value, valueKind)} 
          />
          <Tooltip 
            contentStyle={{ backgroundColor: '#1E293B', borderColor: gridColor, borderRadius: '8px', color: '#F8FAFC' }}
            itemStyle={{ color: '#F8FAFC' }}
            formatter={(value: any) => [this.formatValue(Number(value) || 0, valueKind), 'Value']} 
          />
          <Line type="monotone" dataKey="value" stroke={primaryColor} strokeWidth={3} dot={{ r: 4, fill: primaryColor }} activeDot={{ r: 6 }} />
        </LineChart>
      </ResponsiveContainer>
    );
  }

  private static createPieChart(
    data: ChartData[],
    height: number,
    valueKind: ChartConfig['valueKind'],
    primaryColor: string
  ): React.ReactElement {
    const COLORS = [primaryColor, '#6366F1', '#818CF8', '#A5B4FC', '#C7D2FE', '#E0E7FF'];

    return (
      <ResponsiveContainer width="100%" height={height}>
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={60}
            outerRadius={80}
            paddingAngle={5}
            dataKey="value"
            nameKey="label"
          >
            {data.map((_, index) => (
              <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip 
            contentStyle={{ backgroundColor: '#1E293B', borderColor: '#334155', borderRadius: '8px', color: '#F8FAFC' }}
            itemStyle={{ color: '#F8FAFC' }}
            formatter={(value: any) => [this.formatValue(Number(value) || 0, valueKind), 'Value']} 
          />
          <Legend wrapperStyle={{ fontSize: '12px', color: '#94A3B8' }} />
        </PieChart>
      </ResponsiveContainer>
    );
  }
}
