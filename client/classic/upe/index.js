/**
 * External dependencies
 */
import jQuery from 'jquery';

/**
 * Internal dependencies
 */
import './style.scss';
import WCStripeAPI from '../../api';
import { getStripeServerData } from '../../stripe-utils';
import { getFontRulesFromPage, getAppearance } from '../../styles/upe';

const PAYMENT_METHOD_NAME_CARD = 'stripe';
const PAYMENT_METHOD_NAME_UPE = 'stripe_upe';

jQuery( function ( $ ) {
	const key = getStripeServerData()?.key;
	const isUPEEnabled = getStripeServerData()?.isUPEEnabled;
	const paymentMethodsConfig = getStripeServerData()?.paymentMethodsConfig;

	if ( ! key ) {
		// If no configuration is present, probably this is not the checkout page.
		return;
	}

	// Create an API object, which will be used throughout the checkout.
	const api = new WCStripeAPI(
		{
			key,
			locale: getStripeServerData()?.locale,
			isUPEEnabled,
		},
		// A promise-based interface to jQuery.post.
		( url, args ) => {
			return new Promise( ( resolve, reject ) => {
				jQuery.post( url, args ).then( resolve ).fail( reject );
			} );
		}
	);

	// Object to add hidden elements to compute focus and invalid states for UPE.
	const hiddenElementsForUPE = {
		getHiddenContainer() {
			const hiddenDiv = document.createElement( 'div' );
			hiddenDiv.setAttribute( 'id', 'wc-stripe-hidden-div' );
			hiddenDiv.style.border = 0;
			hiddenDiv.style.clip = 'rect(0 0 0 0)';
			hiddenDiv.style.height = '1px';
			hiddenDiv.style.margin = '-1px';
			hiddenDiv.style.overflow = 'hidden';
			hiddenDiv.style.padding = '0';
			hiddenDiv.style.position = 'absolute';
			hiddenDiv.style.width = '1px';
			return hiddenDiv;
		},
		getHiddenInvalidRow() {
			const hiddenInvalidRow = document.createElement( 'p' );
			hiddenInvalidRow.classList.add(
				'form-row',
				'woocommerce-invalid',
				'woocommerce-invalid-required-field'
			);
			return hiddenInvalidRow;
		},
		appendHiddenClone( container, idToClone, hiddenCloneId ) {
			const hiddenInput = jQuery( idToClone )
				.clone()
				.prop( 'id', hiddenCloneId );
			container.appendChild( hiddenInput.get( 0 ) );
			return hiddenInput;
		},
		init() {
			if ( ! $( ' #billing_first_name' ).length ) {
				return;
			}
			const hiddenDiv = this.getHiddenContainer();

			// // Hidden focusable element.
			$( hiddenDiv ).insertAfter( '#billing_first_name' );
			this.appendHiddenClone(
				hiddenDiv,
				'#billing_first_name',
				'wc-stripe-hidden-input'
			);
			$( '#wc-stripe-hidden-input' ).trigger( 'focus' );

			// Hidden invalid element.
			const hiddenInvalidRow = this.getHiddenInvalidRow();
			this.appendHiddenClone(
				hiddenInvalidRow,
				'#billing_first_name',
				'wc-stripe-hidden-invalid-input'
			);
			hiddenDiv.appendChild( hiddenInvalidRow );

			// Remove transitions.
			$( '#wc-stripe-hidden-input' ).css( 'transition', 'none' );
		},
		cleanup() {
			$( '#wc-stripe-hidden-div' ).remove();
		},
	};

	const elements = api.getStripe().elements( {
		fonts: getFontRulesFromPage(),
	} );

	let upeElement = null;
	let paymentIntentId = null;
	let isUPEComplete = false;
	const hiddenBillingFields = {
		name: 'never',
		email: 'never',
		phone: 'never',
		address: {
			country: 'never',
			line1: 'never',
			line2: 'never',
			city: 'never',
			state: 'never',
			postalCode: 'never',
		},
	};

	/**
	 * Block UI to indicate processing and avoid duplicate submission.
	 *
	 * @param {Object} $form The jQuery object for the form.
	 */
	const blockUI = ( $form ) => {
		$form.addClass( 'processing' ).block( {
			message: null,
			overlayCSS: {
				background: '#fff',
				opacity: 0.6,
			},
		} );
	};

	/**
	 * Unblock UI to remove overlay and loading icon
	 *
	 * @param {Object} $form The jQuery object for the form.
	 */
	const unblockUI = ( $form ) => {
		$form.removeClass( 'processing' ).unblock();
	};

	// Show error notice at top of checkout form.
	const showError = ( errorMessage ) => {
		let messageWrapper = '';
		if ( errorMessage.includes( 'woocommerce-error' ) ) {
			messageWrapper = errorMessage;
		} else {
			messageWrapper =
				'<ul class="woocommerce-error" role="alert">' +
				errorMessage +
				'</ul>';
		}
		const $container = $(
			'.woocommerce-notices-wrapper, form.checkout'
		).first();

		if ( ! $container.length ) {
			return;
		}

		// Adapted from WooCommerce core @ ea9aa8c, assets/js/frontend/checkout.js#L514-L529
		$(
			'.woocommerce-NoticeGroup-checkout, .woocommerce-error, .woocommerce-message'
		).remove();
		$container.prepend(
			'<div class="woocommerce-NoticeGroup woocommerce-NoticeGroup-checkout">' +
				messageWrapper +
				'</div>'
		);
		$container
			.find( '.input-text, select, input:checkbox' )
			.trigger( 'validate' )
			.blur();

		let scrollElement = $( '.woocommerce-NoticeGroup-checkout' );
		if ( ! scrollElement.length ) {
			scrollElement = $container;
		}

		$.scroll_to_notices( scrollElement );
		$( document.body ).trigger( 'checkout_error' );
	};

	// Show or hide save payment information checkbox
	const showNewPaymentMethodCheckbox = ( show = true ) => {
		if ( show ) {
			$( '.woocommerce-SavedPaymentMethods-saveNew' ).show();
		} else {
			$( '.woocommerce-SavedPaymentMethods-saveNew' ).hide();
			$( 'input#wc-woocommerce_payments-new-payment-method' ).prop(
				'checked',
				false
			);
		}
	};

	// Set the selected UPE payment type field
	const setSelectedUPEPaymentType = ( paymentType ) => {
		$( '#wc_stripe_selected_upe_payment_type' ).val( paymentType );
	};

	/**
	 * Converts form fields object into Stripe `billing_details` object.
	 *
	 * @param {Object} fields Object mapping checkout billing fields to values.
	 * @return {Object} Stripe formatted `billing_details` object.
	 */
	const getBillingDetails = ( fields ) => {
		return {
			name: `${ fields.billing_first_name } ${ fields.billing_last_name }`.trim(),
			email: fields.billing_email,
			phone: fields.billing_phone,
			address: {
				country: fields.billing_country,
				line1: fields.billing_address_1,
				line2: fields.billing_address_2,
				city: fields.billing_city,
				state: fields.billing_state,
				postal_code: fields.billing_postcode,
			},
		};
	};

	/**
	 * Mounts Stripe UPE element if feature is enabled.
	 *
	 * @param {boolean} isSetupIntent {Boolean} isSetupIntent Set to true if we are on My Account adding a payment method.
	 */
	const mountUPEElement = function ( isSetupIntent = false ) {
		// Do not mount UPE twice.
		if ( upeElement || paymentIntentId ) {
			return;
		}

		// If paying from order, we need to create Payment Intent from order not cart.
		const isOrderPay = getStripeServerData()?.isOrderPay;
		const isCheckout = getStripeServerData()?.isCheckout;
		let orderId;
		if ( isOrderPay ) {
			orderId = getStripeServerData()?.orderId;
		}

		const intentAction = isSetupIntent
			? api.initSetupIntent()
			: api.createIntent( orderId );

		const $upeContainer = $( '#wc-stripe-upe-element' );
		blockUI( $upeContainer );

		intentAction
			.then( ( response ) => {
				// I repeat, do NOT mount UPE twice.
				if ( upeElement || paymentIntentId ) {
					unblockUI( $upeContainer );
					return;
				}

				const { client_secret: clientSecret, id: id } = response;
				paymentIntentId = id;

				let appearance = getStripeServerData()?.upeAppeareance;

				if ( ! appearance ) {
					hiddenElementsForUPE.init();
					appearance = getAppearance();
					hiddenElementsForUPE.cleanup();
					api.saveUPEAppearance( appearance );
				}

				const businessName = getStripeServerData()?.accountDescriptor;
				const upeSettings = {
					clientSecret,
					appearance,
					business: { name: businessName },
				};
				if ( isCheckout && ! isOrderPay ) {
					upeSettings.fields = {
						billingDetails: hiddenBillingFields,
					};
				}

				upeElement = elements.create( 'payment', upeSettings );
				upeElement.mount( '#wc-stripe-upe-element' );
				unblockUI( $upeContainer );
				upeElement.on( 'change', ( event ) => {
					const selectedUPEPaymentType = event.value.type;
					const isPaymentMethodReusable =
						paymentMethodsConfig[ selectedUPEPaymentType ]
							.isReusable;
					showNewPaymentMethodCheckbox( isPaymentMethodReusable );
					setSelectedUPEPaymentType( selectedUPEPaymentType );
					isUPEComplete = event.complete;
				} );
			} )
			.catch( ( error ) => {
				unblockUI( $upeContainer );
				showError( error.message );
				const gatewayErrorMessage =
					'<div>An error was encountered when preparing the payment form. Please try again later.</div>';
				$( '.payment_box.payment_method_woocommerce_payments' ).html(
					gatewayErrorMessage
				);
			} );
	};

	// Only attempt to mount the card element once that section of the page has loaded. We can use the updated_checkout
	// event for this. This part of the page can also reload based on changes to checkout details, so we call unmount
	// first to ensure the card element is re-mounted correctly.
	$( document.body ).on( 'updated_checkout', () => {
		// If the card element selector doesn't exist, then do nothing (for example, when a 100% discount coupon is applied).
		// We also don't re-mount if already mounted in DOM.
		if (
			$( '#wc-stripe-upe-element' ).length &&
			! $( '#wc-stripe-upe-element' ).children().length &&
			isUPEEnabled &&
			! upeElement
		) {
			mountUPEElement();
		}
	} );

	if (
		$( 'form#add_payment_method' ).length ||
		$( 'form#order_review' ).length
	) {
		if (
			$( '#wc-stripe-upe-element' ).length &&
			! $( '#wc-stripe-upe-element' ).children().length &&
			isUPEEnabled &&
			! upeElement
		) {
			const isChangingPayment = getStripeServerData()?.isChangingPayment;

			// We use a setup intent if we are on the screens to add a new payment method or to change a subscription payment.
			const useSetUpIntent =
				$( 'form#add_payment_method' ).length || isChangingPayment;

			if ( isChangingPayment && getStripeServerData()?.newTokenFormId ) {
				// Changing the method for a subscription takes two steps:
				// 1. Create the new payment method that will redirect back.
				// 2. Select the new payment method and resubmit the form to update the subscription.
				const token = getStripeServerData()?.newTokenFormId;
				$( token ).prop( 'selected', true ).trigger( 'click' );
				$( 'form#order_review' ).submit();
			}
			mountUPEElement( useSetUpIntent );
		}
	}

	/**
	 * Checks if UPE form is filled out. Displays errors if not.
	 *
	 * @param {Object} $form The jQuery object for the form.
	 * @return {boolean} false if incomplete.
	 */
	const checkUPEForm = async ( $form ) => {
		if ( ! upeElement ) {
			showError( 'Your payment information is incomplete.' );
			return false;
		}
		if ( ! isUPEComplete ) {
			// If UPE fields are not filled, confirm payment to trigger validation errors
			const { error } = await api.getStripe().confirmPayment( {
				element: upeElement,
				confirmParams: {
					return_url: '',
				},
			} );
			$form.removeClass( 'processing' ).unblock();
			showError( error.message );
			return false;
		}
		return true;
	};

	/**
	 * Submits the confirmation of the intent to Stripe on Pay for Order page.
	 * Stripe redirects to Order Thank you page on sucess.
	 *
	 * @param {Object} $form The jQuery object for the form.
	 * @return {boolean} A flag for the event handler.
	 */
	const handleUPEOrderPay = async ( $form ) => {
		const isUPEFormValid = await checkUPEForm( $( '#order_review' ) );
		if ( ! isUPEFormValid ) {
			return;
		}
		blockUI( $form );

		try {
			const isSavingPaymentMethod = $(
				'#wc-woocommerce_payments-new-payment-method'
			).is( ':checked' );
			const savePaymentMethod = isSavingPaymentMethod ? 'yes' : 'no';

			const returnUrl =
				getStripeServerData()?.orderReturnURL +
				`&save_payment_method=${ savePaymentMethod }`;

			const orderId = getStripeServerData()?.orderId;

			// Update payment intent with level3 data, customer and maybe setup for future use.
			await api.updateIntent(
				paymentIntentId,
				orderId,
				savePaymentMethod,
				$( '#wc_stripe_selected_upe_payment_type' ).val()
			);

			const { error } = await api.getStripe().confirmPayment( {
				element: upeElement,
				confirmParams: {
					return_url: returnUrl,
				},
			} );
			if ( error ) {
				throw error;
			}
		} catch ( error ) {
			$form.removeClass( 'processing' ).unblock();
			showError( error.message );
		}
	};

	/**
	 * Submits the confirmation of the setup intent to Stripe on Add Payment Method page.
	 * Stripe redirects to Payment Methods page on sucess.
	 *
	 * @param {Object} $form The jQuery object for the form.
	 * @return {boolean} A flag for the event handler.
	 */
	const handleUPEAddPayment = async ( $form ) => {
		const isUPEFormValid = await checkUPEForm( $form );
		if ( ! isUPEFormValid ) {
			return;
		}

		blockUI( $form );

		try {
			const returnUrl = getStripeServerData()?.addPaymentReturnURL;

			const { error } = await api.getStripe().confirmSetup( {
				element: upeElement,
				confirmParams: {
					return_url: returnUrl,
				},
			} );
			if ( error ) {
				throw error;
			}
		} catch ( error ) {
			$form.removeClass( 'processing' ).unblock();
			showError( error.message );
		}
	};

	/**
	 * Submits checkout form via AJAX to create order and uses custom
	 * redirect URL in AJAX response to request payment confirmation from UPE
	 *
	 * @param {Object} $form The jQuery object for the form.
	 * @return {boolean} A flag for the event handler.
	 */
	const handleUPECheckout = async ( $form ) => {
		const isUPEFormValid = await checkUPEForm( $form );
		if ( ! isUPEFormValid ) {
			return;
		}

		blockUI( $form );
		// Create object where keys are form field names and keys are form field values
		const formFields = $form.serializeArray().reduce( ( obj, field ) => {
			obj[ field.name ] = field.value;
			return obj;
		}, {} );
		try {
			const response = await api.processCheckout(
				paymentIntentId,
				formFields
			);
			const redirectUrl = response.redirect_url;
			const upeConfig = {
				element: upeElement,
				confirmParams: {
					return_url: redirectUrl,
					payment_method_data: {
						billing_details: getBillingDetails( formFields ),
					},
				},
			};
			let error;
			if ( response.payment_needed ) {
				( { error } = await api
					.getStripe()
					.confirmPayment( upeConfig ) );
			} else {
				( { error } = await api.getStripe().confirmSetup( upeConfig ) );
			}
			if ( error ) {
				throw error;
			}
		} catch ( error ) {
			$form.removeClass( 'processing' ).unblock();
			showError( error.message );
		}
	};

	/**
	 * Displays the authentication modal to the user if needed.
	 */
	const maybeShowAuthenticationModal = () => {
		const paymentMethodId = $( '#wc-stripe-payment-method' ).val();

		const savePaymentMethod = $(
			'#wc-woocommerce_payments-new-payment-method'
		).is( ':checked' );
		const confirmation = api.confirmIntent(
			window.location.href,
			savePaymentMethod ? paymentMethodId : null
		);

		// Boolean `true` means that there is nothing to confirm.
		if ( confirmation === true ) {
			return;
		}

		const { request, isOrderPage } = confirmation;

		if ( isOrderPage ) {
			blockUI( $( '#order_review' ) );
			$( '#payment' ).hide( 500 );
		}

		// Cleanup the URL.
		// https://stackoverflow.com/a/5298684
		// eslint-disable-next-line no-undef
		history.replaceState(
			'',
			document.title,
			window.location.pathname + window.location.search
		);

		request
			.then( ( redirectUrl ) => {
				window.location = redirectUrl;
			} )
			.catch( ( error ) => {
				$( 'form.checkout' ).removeClass( 'processing' ).unblock();
				$( '#order_review' ).removeClass( 'processing' ).unblock();
				$( '#payment' ).show( 500 );

				let errorMessage = error.message;

				// If this is a generic error, we probably don't want to display the error message to the user,
				// so display a generic message instead.
				if ( error instanceof Error ) {
					errorMessage = getStripeServerData()?.genericErrorMessage;
				}

				showError( errorMessage );
			} );
	};

	/**
	 * Checks if the customer is using a saved payment method.
	 *
	 * @return {boolean} Boolean indicating whether or not a saved payment method is being used.
	 */
	function isUsingSavedPaymentMethod() {
		return (
			$( '#wc-woocommerce_payments-payment-token-new' ).length &&
			! $( '#wc-woocommerce_payments-payment-token-new' ).is( ':checked' )
		);
	}

	// Handle the checkout form when WooCommerce Payments is chosen.
	const wcStripePaymentMethods = [
		PAYMENT_METHOD_NAME_CARD,
		PAYMENT_METHOD_NAME_UPE,
	];
	const checkoutEvents = wcStripePaymentMethods
		.map( ( method ) => `checkout_place_order_${ method }` )
		.join( ' ' );
	$( 'form.checkout' ).on( checkoutEvents, function () {
		if ( ! isUsingSavedPaymentMethod() ) {
			if ( isUPEEnabled && paymentIntentId ) {
				handleUPECheckout( $( this ) );
				return false;
			}
		}
	} );

	// Handle the add payment method form for WooCommerce Payments.
	$( 'form#add_payment_method' ).on( 'submit', function () {
		if ( ! $( '#wc-stripe-setup-intent' ).val() ) {
			if ( isUPEEnabled && paymentIntentId ) {
				handleUPEAddPayment( $( this ) );
				return false;
			}
		}
	} );

	// Handle the Pay for Order form if WooCommerce Payments is chosen.
	$( '#order_review' ).on( 'submit', () => {
		if ( ! isUsingSavedPaymentMethod() ) {
			if ( getStripeServerData()?.isChangingPayment ) {
				handleUPEAddPayment( $( '#order_review' ) );
				return false;
			}
			handleUPEOrderPay( $( '#order_review' ) );
			return false;
		}
	} );

	// On every page load, check to see whether we should display the authentication
	// modal and display it if it should be displayed.
	maybeShowAuthenticationModal();

	// Handle hash change - used when authenticating payment with SCA on checkout page.
	window.addEventListener( 'hashchange', () => {
		if ( window.location.hash.startsWith( '#wc-stripe-confirm-' ) ) {
			maybeShowAuthenticationModal();
		}
	} );
} );