<?php

function Places_after_Q_session_write($params)
{
	// Only act if this was a new session with IP info
	$row = Q::ifset($params, 'row', null);
	if (!$row || !$row->get('ipWasJustSet')) {
		return;
	}

	// Grab IP info
	$data = $row->get('ipWasJustSet');
	if (empty($data['ip']) || empty($data['isPublic'])) {
		return; // nothing useful
	}
	$ip       = $data['ip'];
	$protocol = $data['protocol'];

	// Only proceed if we have a logged-in user
	$user = Users::loggedInUser(false, false);
	if (!$user) {
		return;
	}

	// Base payload
	unset($data['isPublic']);

	// Attempt IP-to-location lookup
	try {
		$className = 'Places_Ip' . $protocol;
		$lookup = call_user_func(array($className, 'lookup'), $ip, array(
			'join' => ['postcode']
		));
		if ($lookup) {
			$postcode = $lookup->get('Places/postcode');
			$city     = $lookup->get('Places/city');
			$data = array_merge(
				$data,
				$lookup->fields,
				$postcode ? $postcode->fields : array()
			);
			unset($data['geohash']);
			$data['Places/geohash'] = Places_Geohash::encode(
				$lookup->fields['latitude'],
				$lookup->fields['longitude']
			);
			unset($data['ipMin'], $data['ipMax']);
		}
	} catch (Exception $e) {
		Q::log("Places: failed IP lookup for $ip ($protocol): ".$e->getMessage(), 'warn');
	}

	// Save/update IP-specific stream
	$stream = Streams_Stream::fetchOrCreate(
		$user->id,
		$user->id,
		'Places/user/location/ip',
		array('subscribe' => true)
	);
	$stream->setAttribute($data);
	$stream->changed();

	// Fire geohash event for listeners
	$config = Q_Config::get('Places','location','ip','changed', false);
	$meters = Q_Config::get('Places','location','ip','meters', null);
	if (!empty($data['Places/geohash'])) {
		Q::event(
			'Places/session/ip/geohash',
			array(
				'geohash'   => $data['Places/geohash'],
				'latitude'  => Q::ifset($data, 'latitude', null),
				'longitude' => Q::ifset($data, 'longitude', null),
				'meters'    => $meters,
				'userId'    => $user->id
			),
			'after'
		);
	}
	if ($config && !empty($data['latitude']) && !empty($data['longitude'])) {
		$shouldUpdate = false;
		if ($config === true) {
			$shouldUpdate = true;
		} elseif ($config === 1) {
			$mainStream = Places_Location::userStream($user->id);
			if (!$mainStream 
			|| !$mainStream->getAttribute('latitude')
			|| !$mainStream->getAttribute('longitude')) {
				$shouldUpdate = true;
			}
		}
		if ($shouldUpdate) {
			Places_Location::changed(array(
				'user'      => $user,
				'source'    => 'ip',
				'latitude'  => $data['latitude'],
				'longitude' => $data['longitude'],
				'meters'    => $meters,
				'joinNearby'=> 2
			));
		}
	}
}