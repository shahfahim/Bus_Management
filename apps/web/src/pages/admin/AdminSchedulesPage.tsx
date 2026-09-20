import { Clock, Plus, Bus, User, MapPin, Calendar, Route as RouteIcon, Save, X, Settings2, Trash2, Edit, Power } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, asItems } from '../../lib/api';
import { PageHeader, Button, Card, SelectField, Field, cx, useToast, Skeleton } from '../../components/ui';
import { AnimatedList, AnimatedListItem, withHoverScale } from '../../components/animations/withAnimation';
import './AdminSchedulesPage.css';

const AnimatedButton = withHoverScale(Button);

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
  const [editingScheduleId, setEditingScheduleId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const { notify } = useToast();

  const initialWizardState = {
    departureTime: '08:00',
    validFrom: new Date().toISOString().split('T')[0],
    validTo: '',
    daysOfWeek: [1, 2, 3, 4, 5],
    routeType: 'existing' as 'existing' | 'custom',
    routeId: '',
    busId: '',
    driverId: '',
    customStops: [] as string[],
  };
  
  // Wizard Form State
  const [wizardState, setWizardState] = useState(initialWizardState);

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
      .then((data) => setSchedules(asItems<Schedule>(data)))
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
      setRoutes(asItems<Route>(rRes));
      setBuses(asItems<BusData>(bRes));
      setDrivers(asItems<UserData>(dRes));
      setStops(asItems<Stop>(sRes));
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

      const payload = {
        routeId: finalRouteId,
        busId: wizardState.busId,
        driverId: wizardState.driverId,
        departureTime: wizardState.departureTime,
        isActive: true,
        validFrom: wizardState.validFrom + 'T00:00:00.000Z',
        validTo: wizardState.validTo ? wizardState.validTo + 'T00:00:00.000Z' : null,
        daysOfWeek: wizardState.daysOfWeek,
      };

      if (editingScheduleId) {
        await api.patch(`/admin/schedules/${editingScheduleId}`, payload);
        notify({ title: 'Success', description: 'Schedule updated successfully', tone: 'success' });
      } else {
        await api.post('/admin/schedules', payload);
        notify({ title: 'Success', description: 'Schedule created successfully', tone: 'success' });
      }

      setIsCreating(false);
      setEditingScheduleId(null);
      setWizardState(initialWizardState);
      loadSchedules();
    } catch (err: any) {
      notify({ title: 'Error', description: err.message || 'Failed to save schedule', tone: 'error' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleEdit = (schedule: Schedule) => {
    loadLookups();
    setWizardState({
      routeType: 'existing',
      routeId: schedule.routeId,
      customStops: [],
      busId: schedule.busId,
      driverId: schedule.driverId,
      departureTime: schedule.departureTime,
      daysOfWeek: schedule.daysOfWeek,
      validFrom: schedule.validFrom ? new Date(schedule.validFrom).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
      validTo: schedule.validTo ? new Date(schedule.validTo).toISOString().split('T')[0] : ''
    });
    setEditingScheduleId(schedule.id);
    setIsCreating(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this schedule?')) return;
    try {
      await api.delete(`/admin/schedules/${id}`);
      notify({ title: 'Success', description: 'Schedule deleted', tone: 'success' });
      loadSchedules();
    } catch (err: any) {
      notify({ title: 'Error', description: err.message || 'Failed to delete', tone: 'error' });
    }
  };

  const handleToggleActive = async (schedule: Schedule) => {
    try {
      await api.patch(`/admin/schedules/${schedule.id}`, { isActive: !schedule.isActive });
      notify({ title: 'Success', description: `Schedule ${!schedule.isActive ? 'activated' : 'deactivated'}`, tone: 'success' });
      loadSchedules();
    } catch (err: any) {
      notify({ title: 'Error', description: err.message || 'Failed to update status', tone: 'error' });
    }
  };

  if (loading) {
    return (
      <div className="admin-schedules-container">
        <PageHeader title="Trip Schedules" description="Manage recurring trips, custom assignments, and operational timetables." eyebrow="Fleet Operations" />
        <div className="schedules-grid">
          <Card><Skeleton lines={4} /></Card>
          <Card><Skeleton lines={4} /></Card>
          <Card><Skeleton lines={4} /></Card>
          <Card><Skeleton lines={4} /></Card>
          <Card><Skeleton lines={4} /></Card>
          <Card><Skeleton lines={4} /></Card>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-schedules-container">
      <PageHeader
        actions={!isCreating && (
          <AnimatedButton variant="primary" icon={<Plus size={18} />} onClick={startCreate}>
            New Schedule
          </AnimatedButton>
        )}
        description="Manage recurring trips, custom assignments, and operational timetables."
        eyebrow="Fleet Operations"
        title={isCreating ? (editingScheduleId ? 'Edit Schedule' : 'Create Schedule') : 'Trip Schedules'}
      />

      {isCreating ? (
        <form className="schedule-wizard" onSubmit={handleCreate}>
          <div className="wizard-header">
            <h2>{editingScheduleId ? 'Edit Schedule' : 'Create New Schedule'}</h2>
            <button type="button" className="close-wizard" onClick={() => { setIsCreating(false); setEditingScheduleId(null); }}><X size={24} /></button>
          </div>
          
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
                    <span style={{fontWeight: 'bold', color: 'var(--primary)'}}>{idx + 1}.</span>
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
            <Button variant="secondary" onClick={() => { setIsCreating(false); setEditingScheduleId(null); }} type="button">Cancel</Button>
            <Button type="submit" loading={submitting} icon={<Save size={18} />}>Save Schedule</Button>
          </div>

        </form>
      ) : (
        <AnimatedList className="schedules-grid">
          {schedules.map(schedule => (
            <AnimatedListItem key={schedule.id} className={cx('schedule-card', !schedule.isActive && 'schedule-card--inactive')}>
              <div className="schedule-card__status" />
              <div className="schedule-card__header">
                <div>
                  <h3 className="schedule-card__route">{schedule.route?.name || 'Custom Route'}</h3>
                  <span className="schedule-card__time">{schedule.departureTime}</span>
                </div>
                <div className="schedule-card__actions">
                  <button type="button" title={schedule.isActive ? "Deactivate" : "Activate"} onClick={() => handleToggleActive(schedule)}>
                    <Power size={18} style={{ color: schedule.isActive ? 'var(--ink-soft)' : 'var(--primary)' }} />
                  </button>
                  <button type="button" title="Edit" onClick={() => handleEdit(schedule)}>
                    <Edit size={18} />
                  </button>
                  <button type="button" title="Delete" onClick={() => handleDelete(schedule.id)} className="delete-btn">
                    <Trash2 size={18} />
                  </button>
                </div>
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
            </AnimatedListItem>
          ))}
          {schedules.length === 0 && (
             <Card style={{ gridColumn: '1 / -1', textAlign: 'center', padding: 40 }}>
                <Clock size={40} style={{ color: 'var(--primary)', margin: '0 auto 16px' }} />
                <h3 style={{ marginBottom: 8 }}>No Schedules Yet</h3>
                <p style={{ color: 'var(--ink-soft)' }}>Create your first schedule to start automating bus trips.</p>
             </Card>
          )}
        </AnimatedList>
      )}
    </div>
  );
}
