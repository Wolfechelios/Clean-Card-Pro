
import StoreShell from '../ui/StoreShell'
import NPCPanel from '../ui/NPCPanel'
import ActionCounter from '../ui/ActionCounter'

export default function CardStore() {
  return (
    <StoreShell>
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 p-4">
        <div className="lg:col-span-3 space-y-4">
          <NPCPanel title="Price Guide" />
          <NPCPanel title="Collector" />
        </div>
        <div className="lg:col-span-6">
          <ActionCounter />
        </div>
        <div className="lg:col-span-3 space-y-4">
          <NPCPanel title="Grading Expert" />
          <NPCPanel title="Authenticator" />
        </div>
      </div>
    </StoreShell>
  )
}
