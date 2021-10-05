import { useDispatch } from '@wordpress/data';
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import InformationOverlay from '../information-overlay';

jest.mock( '@wordpress/data' );
jest.mock( '@woocommerce/data', () => ( {
	OPTIONS_STORE_NAME: 'wc/admin/options',
} ) );

describe( 'InformationOverlay', () => {
	const updateOptionsMock = jest.fn();
	beforeEach( () => {
		useDispatch.mockImplementation( () => ( {
			updateOptions: updateOptionsMock,
		} ) );
	} );

	afterEach( () => {
		jest.clearAllMocks();
	} );

	it( 'renders information about Stripe', () => {
		render( <InformationOverlay /> );

		expect(
			screen.queryByText( 'View your Stripe payment methods' )
		).toBeInTheDocument();
		expect(
			screen.queryByText(
				'In the new payment management experience, you can view and manage all supported Stripe-powered payment methods in a single place.'
			)
		).toBeInTheDocument();
	} );

	it( 'calls the onClose handler on cancel', () => {
		render( <InformationOverlay /> );

		expect( updateOptionsMock ).not.toHaveBeenCalled();

		userEvent.click( screen.queryByRole( 'button', { name: 'Got it' } ) );

		expect( updateOptionsMock ).toHaveBeenCalled();
	} );
} );
