
import { DashboardStats } from '../components/dashboard/dashboard-stats'
import { RecentActivity } from '../components/dashboard/recent-activity'
import { ActiveAgents } from '../components/dashboard/active-agents'

export default function HomePage() {
  return (
    <div className="flex-1 space-y-4 p-4 md:p-8 pt-6">
      <div className="flex items-center justify-between space-y-2">
        <h2 className="text-3xl font-bold tracking-tight">Dashboard</h2>
      </div>
      <div className="space-y-4">
        <DashboardStats />
        <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-7">
          <div className="col-span-1 md:col-span-2 lg:col-span-4">
            <RecentActivity />
          </div>
          <div className="col-span-1 md:col-span-2 lg:col-span-3">
            <ActiveAgents />
          </div>
        </div>
      </div>
    </div>
  )
}
