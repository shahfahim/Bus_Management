import { Clock, Plus, Bus, User, MapPin, Calendar, Route as RouteIcon, Save, X, Settings2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { PageHeader, Button, Card, SelectField, Field, cx, useToast } from '../../components/ui';
import './AdminSchedulesPage.css';

interface Schedule {
  id: string;
  routeId: string;
  busId: string;
  driverId: string;
  departureTime: string;
  isActive: boolean;
  validFrom: string;
  validTo: string | null;
  daysOfWeek: number[];
  route: { name: string; code: string };
  bus: { fleetNumber: string; registrationNumber: string };
  driver: { name?: string; user?: { name: string } };
}

interface Route { id: string; name: string; code: string; }
interface BusData { id: string; fleetNumber: string; registrationNumber: string; }
interface UserData { id: string; name: string; email: string; }
interface Stop { id: string; name: string; }

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function AdminSchedulesPage() {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const { notify } = useToast();

  // Wizard Form State
  const [wizardState, setWizardState] = useState({
    departureTime: '08:00',
    validFrom: new Date().toISOString().split('T')[0],
    validTo: '',
    daysOfWeek: [1, 2, 3, 4, 5],
    routeType: 'existing' as 'existing' | 'custom',
    routeId: '',
    busId: '',
    driverId: '',
    customStops: [] as string[],
  });

  // Lookups
  const [routes, setRoutes] = useState<Route[]>([]);
  const [buses, setBuses] = useState<BusData[]>([]);
  const [drivers, setDrivers] = useState<UserData[]>([]);
  const [stops, setStops] = useState<Stop[]>([]);
  
  // Custom stops selector state
  const [selectedStopToAdd, setSelectedStopToAdd] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    loadSchedules();
  }, []);

  const loadSchedules = () => {
    setLoading(true);
    api.get<Schedule[]>('/admin/schedules')
      .then((data) => setSchedules(data || []))
      .catch(() => notify({ title: 'Error', description: 'Failed to load schedules', tone: 'error' }))
      .finally(() => setLoading(false));
  };

  const loadLookups = () => {
    Promise.all([
      api.get<{data: Route[]}>('/admin/routes'),
      api.get<{data: BusData[]}>('/admin/buses'),
      api.get<{data: UserData[]}>('/admin/users?role=driver&status=active'),
      api.get<{data: Stop[]}>('/admin/stops')
    ]).then(([rRes, bRes, dRes, sRes]) => {
      setRoutes(rRes?.data || []);
      setBuses(bRes?.data || []);
      setDrivers(dRes?.data || []);
      setStops(sRes?.data || []);
    });
  };

  const toggleDay = (dayIndex: number) => {
    setWizardState(prev => {
      const exists = prev.daysOfWeek.includes(dayIndex);
      return {
        ...prev,
        daysOfWeek: exists ? prev.daysOfWeek.filter(d => d !== dayIndex) : [...prev.daysOfWeek, dayIndex].sort()
      };
    });
  };

  const startCreate = () => {
    loadLookups();
    setIsCreating(true);
  };

  const addCustomStop = () => {
    if (selectedStopToAdd && !wizardState.customStops.includes(selectedStopToAdd)) {
      setWizardState(prev => ({ ...prev, customStops: [...prev.customStops, selectedStopToAdd] }));
      setSelectedStopToAdd('');
    }
  };

  const removeCustomStop = (index: number) => {
    setWizardState(prev => ({ ...prev, customStops: prev.customStops.filter((_, i) => i !== index) }));
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (wizardState.daysOfWeek.length === 0) {
      notify({ title: 'Validation', description: 'Select at least one day', tone: 'error' });
      return;
    }
    setSubmitting(true);

    try {
      let finalRouteId = wizardState.routeId;
      
      if (wizardState.routeType === 'custom') {
        if (wizardState.customStops.length < 2) {
           notify({ title: 'Validation', description: 'Custom routes need at least 2 stops', tone: 'error' });
           setSubmitting(false);
           return;
        }
        
        // Create custom route
        const code = `CR-${Date.now().toString().slice(-6)}`;
        const routePayload = {
          code,
          name: `Custom Route ${code}`,
          distanceKm: 5,
          estimatedDurationMinutes: 30,
        };
        const newRoute = await api.post<Route>('/admin/routes', routePayload);
        
        // We'd ideally add stops to the route here if the backend had a simple endpoint
        // For now, we link the schedule to this newly generated Route ID.
        finalRouteId = newRoute.id;
      }

      await api.post('/admin/schedules', {
        routeId: finalRouteId,
        busId: wizardState.busId,
        driverId: wizardState.driverId,
        departureTime: wizardState.departureTime,
        isActive: true,
        validFrom: wizardState.validFrom + 'T00:00:00.000Z',
        validTo: wizardState.validTo ? wizardState.validTo + 'T00:00:00.000Z' : null,
        daysOfWeek: wizardState.daysOfWeek,
      });

      notify({ title: 'Success', description: 'Schedule created successfully', tone: 'success' });
      setIsCreating(false);
      loadSchedules();
    } catch (err) {
      notify({ title: 'Error', description: 'Failed to create schedule', tone: 'error' });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <div className="admin-schedules-container">Loading...</div>;
  }

  return (
    <div className="admin-schedules-container">
      <PageHeader
        actions={!isCreating && (
          <Button icon={<Plus size={18} />} onClick={startCreate}>
            New Schedule
          </Button>
        )}
        description="Manage recurring trips, custom assignments, and operational timetables."
        eyebrow="Fleet Operations"
        title={isCreating ? 'Create Schedule' : 'Trip Schedules'}
      />

      {isCreating ? (
        <form className="schedule-wizard" onSubmit={handleCreate}>
          
          <div className="wizard-section">
            <h3><Calendar size={20} /> Schedule Days & Timing</h3>
            <div className="form-grid" style={{ marginBottom: 20 }}>
              <Field 
                label="Departure Time (HH:MM)" 
                required 
                type="time"
                value={wizardState.departureTime}
                onChange={(e) => setWizardState({...wizardState, departureTime: e.target.value})}
              />
              <div className="form-grid">
                <Field 
                  label="Valid From" 
                  required 
                  type="date"
                  value={wizardState.validFrom}
                  onChange={(e) => setWizardState({...wizardState, validFrom: e.target.value})}
                />
                <Field 
                  label="Valid Until (Optional)" 
                  type="date"
                  value={wizardState.validTo}
                  onChange={(e) => setWizardState({...wizardState, validTo: e.target.value})}
                />
              </div>
            </div>
            <label className="field__label" style={{ marginBottom: 12, display: 'block' }}>Days of Operation</label>
            <div className="days-selector">
              {DAYS.map((day, idx) => (
                <label className="day-checkbox" key={day}>
                  <input 
                    type="checkbox" 
                    checked={wizardState.daysOfWeek.includes(idx)}
                    onChange={() => toggleDay(idx)}
                  />
                  <span>{day}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="wizard-section">
            <h3><MapPin size={20} /> Route Selection</h3>
            <div className="route-type-toggle">
              <button 
                type="button" 
                className={cx('route-type-btn', wizardState.routeType === 'existing' && 'active')}
                onClick={() => setWizardState({...wizardState, routeType: 'existing', customStops: []})}
              >
                <RouteIcon /> Existing Route
              </button>
              <button 
                type="button" 
                className={cx('route-type-btn', wizardState.routeType === 'custom' && 'active')}
                onClick={() => setWizardState({...wizardState, routeType: 'custom', routeId: ''})}
              >
                <Settings2 /> Custom Locations
              </button>
            </div>

            {wizardState.routeType === 'existing' ? (
              <SelectField 
                label="Select Route"
                required
                value={wizardState.routeId}
                onChange={e => setWizardState({...wizardState, routeId: e.target.value})}
                options={[{value: '', label: 'Choose a route', disabled: true}, ...routes.map(r => ({ value: r.id, label: r.name }))]}
              />
            ) : (
              <div className="custom-stops-selector">
                <label className="field__label">Define Custom Route Stops</label>
                {wizardState.customStops.map((stopId, idx) => (
                  <div key={idx} className="stop-item">
                    <span style={{fontWeight: 'bold', color: 'var(--color-primary)'}}>{idx + 1}.</span>
                    {stops.find(s => s.id === stopId)?.name}
                    <button type="button" onClick={() => removeCustomStop(idx)}><X size={16} /></button>
                  </div>
                ))}
                <div className="add-stop-control">
                  <SelectField 
                    label=""
                    value={selectedStopToAdd}
                    onChange={e => setSelectedStopToAdd(e.target.value)}
                    options={[{value: '', label: 'Select a stop to add', disabled: true}, ...stops.map(s => ({ value: s.id, label: s.name }))]}
                  />
                  <Button type="button" onClick={addCustomStop} variant="secondary">Add Stop</Button>
                </div>
              </div>
            )}
          </div>

          <div className="wizard-section">
            <h3><Bus size={20} /> Fleet & Driver Assignment</h3>
            <div className="form-grid">
              <SelectField 
                label="Assign Bus"
                required
                value={wizardState.busId}
                onChange={e => setWizardState({...wizardState, busId: e.target.value})}
                options={[{value: '', label: 'Choose bus', disabled: true}, ...buses.map(b => ({ value: b.id, label: b.registrationNumber }))]}
              />
              <SelectField 
                label="Assign Driver"
                required
                value={wizardState.driverId}
                onChange={e => setWizardState({...wizardState, driverId: e.target.value})}
                options={[{value: '', label: 'Choose driver', disabled: true}, ...drivers.map(d => ({ value: d.id, label: d.name }))]}
              />
            </div>
          </div>

          <div className="wizard-actions">
            <Button variant="secondary" onClick={() => setIsCreating(false)} type="button">Cancel</Button>
            <Button type="submit" loading={submitting} icon={<Save size={18} />}>Save Schedule</Button>
          </div>

        </form>
      ) : (
        <div className="schedules-grid">
          {schedules.map(schedule => (
            <div key={schedule.id} className={cx('schedule-card', !schedule.isActive && 'schedule-card--inactive')}>
              <div className="schedule-card__status" />
              <div className="schedule-card__header">
                <h4 className="schedule-card__route">{schedule.route?.name || 'Unknown Route'}</h4>
                <span className="schedule-card__time">{schedule.departureTime}</span>
              </div>
              
              <div className="schedule-card__days">
                {DAYS.map((day, idx) => (
                  <span key={day} className={cx('day-badge', schedule.daysOfWeek.includes(idx) && 'active')}>{day[0]}</span>
                ))}
              </div>

              <div className="schedule-card__details">
                <p><Bus size={16} /> {schedule.bus?.registrationNumber}</p>
                <p><User size={16} /> {schedule.driver?.user?.name || schedule.driver?.name || 'Assigned Driver'}</p>
              </div>
            </div>
          ))}
          {schedules.length === 0 && (
             <Card style={{ gridColumn: '1 / -1', textAlign: 'center', padding: 40 }}>
                <Clock size={40} style={{ color: 'var(--color-primary)', margin: '0 auto 16px' }} />
                <h3 style={{ marginBottom: 8 }}>No Schedules Yet</h3>
                <p style={{ color: 'var(--color-text-muted)' }}>Create your first schedule to start automating bus trips.</p>
             </Card>
          )}
        </div>
      )}
    </div>
  );
}
