import { Link } from 'react-router-dom'
import { Card } from '../components/Card'
import { StateBlock } from '../components/StateBlock'
import { buttonClassName } from '../components/Button'
import { useDocumentTitle } from '../lib/hooks'

export function NotFoundPage() {
  useDocumentTitle('Page not found')

  return (
    <div className="container main--narrow">
      <Card>
        <StateBlock
          icon="404"
          title="That page does not exist"
          actions={
            <>
              <Link className={buttonClassName('primary')} to="/">
                Back to the start
              </Link>
              <Link className={buttonClassName('secondary')} to="/book">
                Book an appointment
              </Link>
            </>
          }
        >
          The address may be mistyped, or the page may have moved.
        </StateBlock>
      </Card>
    </div>
  )
}
