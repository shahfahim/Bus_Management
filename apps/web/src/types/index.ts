export type Role = 'STUDENT' | 'TEACHER' | 'DRIVER' | 'CONDUCTOR' | 'ADMIN';
export type EntityStatus = 'ACTIVE' | 'INACTIVE' | 'MAINTENANCE';
export type BookingStatus = 'PENDING' | 'CONFIRMED' | 'CHECKED_IN' | 'CANCELLED' | 'COMPLETED' | 'EXPIRED' | 'REFUND_PENDING' | 'REFUNDED';
export type PaymentStatus = 'PENDING' | 'PROCESSING' | 'SUCCESS' | 'FAILED' | 'REFUND_PENDING' | 'PARTIALLY_REFUNDED' | 'REFUNDED';
export type TripStatus = 'SCHEDULED' | 'BOARDING' | 'IN_PROGRESS' | 'DELAYED' | 'CANCELLED' | 'COMPLETED';

export interface User {
  id: string;
  name: string;
  email: string;
  phone?: string;
  avatarUrl?: string;
  role: Role;
  studentId?: string;
  department?: string;
  active?: boolean;
  createdAt?: string;
  mustChangePassword?: boolean;
}

export interface Coordinates {
  latitude: number;
  longitude: number;
}

export interface Stop extends Coordinates {
  id: string;
  name: string;
  address?: string;
  sequence?: number;
  scheduledOffsetMinutes?: number;
}

export interface Route {
  id: string;
  name: string;
  code: string;
  origin: string;
  destination: string;
  distanceKm?: number;
  durationMinutes?: number;
  active?: boolean;
  stops: Stop[];
  path?: [number, number][];
}

export interface Bus {
  id: string;
  registrationNumber: string;
  label?: string;
  model?: string;
  capacity: number;
  status: EntityStatus;
  amenities?: string[];
  currentLocation?: Coordinates & { recordedAt?: string; heading?: number; speedKph?: number };
  expectedAvailableAt?: string;
}

export interface DriverSummary {
  id: string;
  name: string;
  phone?: string;
  averageRating?: number;
}

export interface Trip {
  id: string;
  routeId: string;
  route?: Route;
  busId: string;
  bus?: Bus;
  driver?: DriverSummary;
  departureTime: string;
  estimatedArrivalTime: string;
  actualDepartureTime?: string;
  actualArrivalTime?: string;
  availableSeats: number;
  totalSeats?: number;
  fare: number;
  currency?: string;
  status: TripStatus;
  delayMinutes?: number;
  boardingStopId?: string;
  destinationStopId?: string;
  currentLocation?: Coordinates & { recordedAt?: string; heading?: number; speedKph?: number };
}

export interface Seat {
  number: string;
  label?: string;
  deck?: number;
  type?: 'STANDARD' | 'PRIORITY' | 'ACCESSIBLE';
  status: 'AVAILABLE' | 'HELD' | 'BOOKED' | 'BLOCKED';
  heldByCurrentUser?: boolean;
}

export interface Booking {
  id: string;
  reference: string;
  studentId: string;
  tripId: string;
  trip?: Trip;
  seatNumber: string;
  boardingStop?: Stop;
  destinationStop?: Stop;
  status: BookingStatus;
  totalAmount: number;
  currency?: string;
  paymentStatus?: PaymentStatus;
  qrToken?: string;
  qrExpiresAt?: string;
  checkedInAt?: string;
  createdAt: string;
  cancelledAt?: string;
}

export interface Payment {
  id: string;
  transactionId?: string;
  bookingId?: string;
  booking?: Pick<Booking, 'reference'> & { bookingNumber?: string };
  amount: number;
  currency?: string;
  status: PaymentStatus;
  method?: string;
  receiptUrl?: string;
  paidAt?: string;
  createdAt: string;
}

export interface SubscriptionPlan {
  id: string;
  code: string;
  name: string;
  description?: string;
  price: number | string;
  currency?: string;
  durationDays: number;
  tripLimit?: number | null;
  routes: Array<Pick<Route, 'id' | 'code' | 'name'>> | Array<{ route: Pick<Route, 'id' | 'code' | 'name'> }>;
}

export interface StudentSubscription {
  id: string;
  reference: string;
  status: 'PENDING_PAYMENT' | 'ACTIVE' | 'PAUSED' | 'EXPIRED' | 'CANCELLED';
  startsAt?: string;
  endsAt?: string;
  remainingTrips?: number | null;
  createdAt: string;
  plan: SubscriptionPlan;
}

export interface AppNotification {
  id: string;
  title: string;
  message: string;
  type?: 'BOOKING' | 'PAYMENT' | 'ETA' | 'MAINTENANCE' | 'ROAD_ALERT' | 'TRIP' | 'LOST_FOUND' | 'SYSTEM';
  readAt?: string;
  actionUrl?: string;
  createdAt: string;
}

export type RoadAlertCategory = 'TRAFFIC' | 'ROADBLOCK' | 'ACCIDENT' | 'CONSTRUCTION' | 'WEATHER' | 'OTHER';

export interface RoadAlert {
  id: string;
  routeId: string;
  route?: Pick<Route, 'id' | 'name' | 'code'>;
  affectedRoutes?: Array<Pick<Route, 'id' | 'name' | 'code'>>;
  category: RoadAlertCategory;
  title: string;
  description: string;
  severity: 'INFO' | 'MINOR' | 'MODERATE' | 'MAJOR' | 'CRITICAL' | 'LOW' | 'MEDIUM' | 'HIGH';
  coordinates?: Coordinates;
  activeFrom: string;
  activeUntil?: string;
  active: boolean;
}

export interface MaintenanceRecord {
  id: string;
  busId: string;
  bus?: Bus;
  reason: string;
  notes?: string;
  startedAt: string;
  expectedAvailableAt?: string;
  completedAt?: string;
  status: 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
}

export interface LostFoundReport {
  id: string;
  type: 'LOST' | 'FOUND';
  title: string;
  description: string;
  category?: string;
  location: string;
  occurredAt: string;
  imageUrl?: string;
  reporter?: Pick<User, 'id' | 'name'>;
  status: 'OPEN' | 'POTENTIAL_MATCH' | 'CLAIMED' | 'CLOSED' | 'REJECTED';
  verified?: boolean;
  matchCount?: number;
  createdAt: string;
}

export interface Rating {
  id: string;
  driverId: string;
  driver?: DriverSummary;
  studentId?: string;
  tripId: string;
  score: number;
  comment?: string;
  createdAt: string;
}

export interface Passenger {
  bookingId: string;
  reference: string;
  student: Pick<User, 'id' | 'name' | 'studentId'>;
  seatNumber: string;
  boardingStop?: Stop;
  checkedInAt?: string;
}

export interface ApiPage<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface AuthResponse {
  user: User;
  expiresIn: number;
}

export interface RegistrationResponse {
  user: User;
  approvalRequired: true;
}

export interface DashboardSummary {
  activeTrips?: number;
  completedTrips?: number;
  upcomingBookings?: number;
  unreadNotifications?: number;
  totalStudents?: number;
  activeBuses?: number;
  driversOnDuty?: number;
  bookingsToday?: number;
  revenueToday?: number;
  assignedTrips?: number;
  passengersToday?: number;
  nextTrip?: Trip;
  alerts?: RoadAlert[];
}
